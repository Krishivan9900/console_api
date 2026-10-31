const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const logic = require('../src/app/services/productSearch.logic');
const { rankProductMatches, PRODUCT_SEARCH_MAX_ITEMS } = logic;

function load(file, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, {
    exports, process: { env: {} }, console: { log() {}, error() {}, warn() {} },
    require(name) { assert(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`); return mocks[name]; },
  });
  return exports;
}

const products = [
  { retailer_id: 'hose', name: 'Pressure Hose', description: 'Irrigation pipe' },
  { retailer_id: 'tarp', name: 'Heavy Duty Tarp', description: 'Waterproof tarpaulin' },
  { retailer_id: '160-yellow', name: '160 GSM-18*24', description: 'Product Yellow Tarpaulin', product_id: 'yellow-tarp' },
  { retailer_id: '200-yellow', name: '200GSM-24*30', description: 'Product Yellow Tarpaulin', product_id: 'yellow-tarp' },
  { retailer_id: '160-blue', name: '160 G.S.M.-24*30', description: 'Product Blue Tarpaulin' },
  { retailer_id: 'seed', name: 'Wheat Seeds', description: 'Certified wheat seed' },
  { retailer_id: 'fertilizer', name: 'Organic Fertiliser', description: 'Farm nutrition' },
];

test('GSM finds variant names first and recommends related tarpaulins without returning unrelated products', () => {
  const results = rankProductMatches(products, 'GSM');
  assert.deepEqual(results.filter(r => r.matchType === 'matching').map(r => r.product.retailer_id),
    ['160-yellow', '200-yellow', '160-blue']);
  assert.equal(results.at(-1).product.retailer_id, 'tarp');
  assert.equal(results.at(-1).matchType, 'recommended');
  assert(!results.some(r => ['hose', 'seed', 'fertilizer'].includes(r.product.retailer_id)));
});

test('synonyms, singular/plural, common typos and local-language terms return actual catalog recommendations', () => {
  for (const query of ['tarp', 'tarpaulins', 'tirpal', 'tripal', 'tarpolin', 'तिरपाल', 'తార్పాలిన్']) {
    const ids = rankProductMatches(products, query).map(r => r.product.retailer_id);
    assert(ids.includes('160-yellow'), `${query} should find a tarpaulin`);
    assert(!ids.includes('hose'));
  }
  for (const query of ['fertilizer', 'fertiliser', 'fertilzer', 'खाद', 'ఎరువులు']) {
    assert.deepEqual(rankProductMatches(products, query).map(r => r.product.retailer_id), ['fertilizer']);
  }
});

test('all meaningful search words and exact numeric specifications affect ranking', () => {
  const results = rankProductMatches(products, 'please show me yellow tarpaulin 160 GSM');
  assert.equal(results[0].product.retailer_id, '160-yellow');
  assert.equal(results[0].matchType, 'matching');
  assert.equal(results.find(r => r.product.retailer_id === '200-yellow').matchType, 'recommended');
  const numeric = rankProductMatches([
    { retailer_id: '1600', name: '1600 GSM Tarpaulin' }, { retailer_id: '160', name: '160 GSM Tarpaulin' },
  ], '160');
  assert.deepEqual(numeric.map(r => r.product.retailer_id), ['160']);
});

test('blank, conversational-only and unknown searches never return an arbitrary catalog', () => {
  for (const query of ['', '   ', 'please show me products', 'unobtainium', '%_']) {
    assert.equal(rankProductMatches(products, query).length, 0, query);
  }
});

test('results are unique, available and capped below 30 across direct and related recommendations', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ retailer_id: `gsm-${i}`, name: `${160 + i} GSM Tarpaulin` }));
  const results = rankProductMatches([
    { retailer_id: 'bad1', name: 'GSM', availability: 'out_of_stock' },
    { retailer_id: 'bad2', name: 'GSM', review_status: 'rejected' },
    { retailer_id: 'bad3', name: 'GSM', deleted_at: new Date() },
    { retailer_id: 'bad4', name: 'GSM', meta_status: 'failed' },
    { name: 'GSM' }, ...many, ...many,
  ], 'gsm', 100);
  assert.equal(results.length, PRODUCT_SEARCH_MAX_ITEMS);
  assert.equal(new Set(results.map(r => r.product.retailer_id)).size, PRODUCT_SEARCH_MAX_ITEMS);
  assert(!results.some(r => r.product.retailer_id.startsWith('bad')));
});

function nodeRuntime(catalog = products) {
  const calls = { fetched: [], updates: [] };
  const { executeProductMessageNode } = load('src/app/services/chatbot/engine/productSearch.ts', {
    '@surefy/console/app/models/chatSession.model': { update: async (_id, data) => calls.updates.push(data) },
    '@surefy/console/models/productGroup.model': { getCatalogGroups: async () => [{ catalog_id: 'fallback-catalog' }] },
    '@surefy/console/services/meta.service': { PRODUCT_LIST_MAX_ITEMS: 28,
      getAllCatalogProducts: async id => { calls.fetched.push(id); return catalog; } },
    '../../productSearch.logic': logic,
  });
  const question = { id: 'question', data: { key: '@whatsapp/ask-question', attributes: { variable: 'product_name' } } };
  const node = { id: 'catalog', data: { key: '@whatsapp/send-product-message', attributes: {
    message: { interactive: { action: { catalog_id: 'configured-catalog' } } },
  } } };
  const bot = { nodes: [question, { id: 'http' }, { id: 'condition' }, node], edges: [
    { source: 'question', target: 'http' }, { source: 'http', target: 'condition' },
    { source: 'condition', target: 'catalog' },
  ] };
  const session = { id: 'session', variables: { product_name: 'GSM' } };
  return { calls, node, bot, session, run: () => executeProductMessageNode({ bot, session, currentNode: node }) };
}

test('product nodes honor the configured catalog, separate recommendations, and never exceed 28 sent IDs', async () => {
  const rt = nodeRuntime();
  const response = await rt.run();
  assert.deepEqual(rt.calls.fetched, ['configured-catalog']);
  assert.equal(response.interactive.action.catalog_id, 'configured-catalog');
  assert.deepEqual(Array.from(response.interactive.action.sections, s => s.title), ['Matching products', 'Related recommendations']);
  assert.equal(rt.calls.updates[0].current_node_id, 'question');
  const many = nodeRuntime(Array.from({ length: 80 }, (_, i) => ({ retailer_id: `gsm-${i}`, name: `${160 + i} GSM Tarpaulin` })));
  const message = await many.run();
  assert.equal(message.interactive.action.sections.flatMap(s => s.product_items).length, 28);
  assert.match(message.interactive.body.text, /Showing 28/);
});

test('booking reuses only a catalog response for the same query and catalog', async () => {
  const rt = nodeRuntime();
  rt.session.variables.http_response = {
    success: true, catalog_id: 'configured-catalog', search_term: 'gsm',
    product_matches: [
      { retailer_id: 'match', name: '160 GSM', match_type: 'matching' },
      { retailer_id: 'related', name: 'Tarp', match_type: 'recommended' },
      { retailer_id: 'related', name: 'Duplicate Tarp', match_type: 'recommended' },
    ],
  };
  const response = await rt.run();
  assert.equal(rt.calls.fetched.length, 0);
  assert.deepEqual(Array.from(response.interactive.action.sections.flatMap(s => s.product_items), p => p.product_retailer_id), ['match', 'related']);
  rt.session.variables.http_response.search_term = 'hoses';
  await rt.run();
  assert.equal(rt.calls.fetched.length, 1);
});

test('no matches return to the product question through HTTP/condition nodes, even with cycles', async () => {
  const rt = nodeRuntime([]);
  rt.bot.edges.push({ source: 'condition', target: 'http' });
  const response = await rt.run();
  assert.equal(response.type, 'text');
  assert.match(response.text, /another product name/);
  assert.equal(rt.calls.updates[0].current_node_id, 'question');
});

test('database search stays within the catalog and passes ranked recommendation metadata through the API', async () => {
  const scopes = [];
  class BaseModel {
    query() {
      return { where: value => { scopes.push(value); return {
        whereNull: column => { assert.equal(column, 'deleted_at'); return { select: async () => products }; },
      }; } };
    }
  }
  const model = load('src/app/models/productVariant.model.ts', {
    '@surefy/models/base.model': { BaseModel }, '../services/productSearch.logic': logic,
  }).default;
  const matched = await model.findByProductName('GSM', 'only-this-catalog');
  assert.equal(scopes[0].catalog_id, 'only-this-catalog');
  assert.equal(matched[0].search_match_type, 'matching');
  assert.equal(matched.at(-1).search_match_type, 'recommended');
  assert.equal((await model.findByProductName('', 'only-this-catalog')).length, 0);

  const source = ts.createSourceFile('catalog.ts', fs.readFileSync(path.join(__dirname, '../src/app/services/catalog.service.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const method = source.statements.find(ts.isClassDeclaration).members.find(m => m.name?.getText(source) === 'getProductVariants');
  const service = vm.runInNewContext(ts.transpileModule(`new class { ${method.getText(source)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, { productVariantModel: model, console: { log() {} } });
  const result = await service.getProductVariants('GSM', 'only-this-catalog');
  assert.equal(result.success, true);
  assert.equal(result.search_term, 'GSM');
  assert.equal(result.catalog_id, 'only-this-catalog');
  assert.equal(result.data.length, result.product_matches.length);
  assert.equal(result.product_matches.at(-1).match_type, 'recommended');
});
