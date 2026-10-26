const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

class BadRequest extends Error {
  constructor({ message, details }) { super(message); this.details = details; this.statusCode = 400; }
}

function service(file, methods, globals = {}) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(ts.isClassDeclaration);
  const members = declaration.members.filter(member => methods.includes(member.name?.getText(source)));
  return vm.runInNewContext(ts.transpileModule(`new class { ${members.map(member => member.getText(source)).join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    console: { log() {}, error() {} }, process: { env: {} }, URL, Buffer,
    HTTP400Error: BadRequest, setTimeout: fn => fn(), ...globals,
  });
}

function metaRuntime(post, statuses = []) {
  const calls = [];
  const meta = service('src/app/services/meta.service.ts', [
    'catalogError', 'getCatalogDetails', 'createProductVariantBatch', 'createProductVariantsBatch',
  ]);
  meta.client = {
    post: async (url, body) => { calls.push({ url, body }); if (post instanceof Error) throw post; return { data: post }; },
    get: async (url, config) => {
      calls.push({ url, config });
      const status = statuses.length > 1 ? statuses.shift() : statuses[0];
      return { data: { data: status ? [status] : [] } };
    },
  };
  return { meta, calls };
}

const request = id => ({ method: 'UPDATE', item_type: 'PRODUCT_ITEM', retailer_id: id, data: {} });

test('HTTP 200 validation errors and empty handles never count as a successful Meta upload', async () => {
  for (const body of [
    { validation_status: [{ retailer_id: 'item', errors: [{ message: 'data[image_url] should represent a valid URL' }] }] },
    { handles: [] },
  ]) {
    const { meta, calls } = metaRuntime(body);
    await assert.rejects(meta.createProductVariantBatch('catalog', request('item')), /valid URL|no batch handle/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.allow_upsert, true);
  }
});

test('Meta validation failures and ingestion failures are attributed to their products', async () => {
  const { meta, calls } = metaRuntime({
    handles: ['handle'], validation_status: [{ retailer_id: 'bad-image', errors: [{ message: 'Invalid image' }] }],
  }, [
    { status: 'started' },
    { status: 'finished', errors_total_count: 1, ids_of_invalid_requests: ['rejected'], errors: [{ id: 'rejected', message: 'Product rejected' }] },
  ]);
  const result = await meta.createProductVariantsBatch('catalog', ['good', 'bad-image', 'rejected'].map(request));
  assert.equal(result.items.find(item => item.retailer_id === 'good').status, 'synced');
  assert.equal(result.items.find(item => item.retailer_id === 'bad-image').error, 'Invalid image');
  assert.equal(result.items.find(item => item.retailer_id === 'rejected').error, 'Product rejected');
  assert.equal(calls.length, 3);
  assert.equal(calls[1].config.params.load_ids_of_invalid_requests, true);
});

test('a batch still processing remains pending and failures without item IDs never claim success', async () => {
  for (const [status, expected] of [
    [{ status: 'started' }, 'pending'],
    [{ status: 'finished', errors_total_count: 1, errors: [{ message: 'Unknown product failure' }] }, 'failed'],
    [{ status: 'failed' }, 'failed'],
    [{ status: 'finished', errors_total_count: 1, ids_of_invalid_requests: ['unrecognized-id'] }, 'failed'],
  ]) {
    const { meta } = metaRuntime({ handles: ['handle'] }, [status]);
    const result = await meta.createProductVariantsBatch('catalog', [request('item')]);
    assert.equal(result.items[0].status, expected);
  }
});

test('catalog errors retain the actual OAuth error code and trace ID', async () => {
  const error = Object.assign(new Error('HTTP 400'), { response: { data: { error: {
    message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190,
    error_subcode: 463, fbtrace_id: 'trace-id',
  } } } });
  const { meta } = metaRuntime(error);
  await assert.rejects(meta.createProductVariantsBatch('catalog', [request('item')]), error => {
    assert.match(error.message, /Session has expired/);
    assert.equal(error.details.code, 190);
    assert.equal(error.details.fbtrace_id, 'trace-id');
    return true;
  });
});

function catalogRuntime(variants, options = {}) {
  const calls = { saved: [], updated: [], batches: [], lookups: [], uploads: [] };
  const catalogId = 'catalog';
  const catalog = service('src/app/services/catalog.service.ts', [
    'catalogImageUrl', 'getAllOrgVariants', 'syncVariant', 'syncOrganizationCatalog',
  ], {
    createHash: require('node:crypto').createHash,
    bucket: {
      name: 'test-bucket',
      file: objectName => ({ save: async (buffer, metadata) => calls.uploads.push({ objectName, buffer, metadata }), makePublic: async () => {} }),
    },
    axios: { get: async () => ({ data: { success: true, data: variants } }) },
    productGroupModel: { getCatalogGroups: async (companyId, userId) => {
      assert.equal(companyId, 'company'); assert.equal(userId, 'user');
      return [{ id: 'group', catalog_id: catalogId, categories: ['Irrigation'] }];
    } },
    productVariantModel: {
      findByVariantId: async (id, catalog) => { calls.lookups.push({ id, catalog }); return options.existing?.[id]; },
      create: async data => { calls.saved.push(data); return { ...data, id: data.variant_id }; },
      update: async (id, data) => { calls.updated.push({ id, ...data }); return { id, ...data }; },
    },
    metaService: {
      getCatalogDetails: async () => { if (options.preflightError) throw options.preflightError; return { id: catalogId }; },
      createProductVariantsBatch: async (catalogId, requests) => {
        calls.batches.push({ catalogId, requests });
        if (options.metaError) throw options.metaError;
        return { handles: ['handle'], items: requests.map(r => ({ retailer_id: r.retailer_id, status: options.status || 'synced' })) };
      },
    },
  });
  return { catalog, calls, run: () => catalog.syncOrganizationCatalog('user', 'company', catalogId) };
}

const variant = id => ({ _id: id, product_id: 'shared-product', productName: 'Sprinkler', categoryName: 'Irrigation',
  brandName: 'Example', salePrice: '15000', gstRate: '5', productImage: 'https://example.test/image.webp', sizeColor: '75 MM' });

test('242 source variants keep distinct _id identities and are submitted in three upsert batches', async () => {
  const source = Array.from({ length: 242 }, (_, i) => variant(`variant-${i}`));
  const rt = catalogRuntime(source, { existing: { 'variant-0': { id: 'local-0', retailer_id: 'original_variant-0', meta_status: 'failed' } } });
  const result = await rt.run();
  assert.equal(result.total, 242);
  assert.equal(result.success, 242);
  assert.equal(result.failed, 0);
  assert.equal(result.pending, 0);
  assert.deepEqual(rt.calls.batches.map(b => b.requests.length), [100, 100, 42]);
  assert(rt.calls.batches.flatMap(batch => batch.requests).some(item => item.retailer_id === 'original_variant-0'));
  assert.equal(rt.calls.batches[0].requests[0].method, 'UPDATE');
  assert.equal(rt.calls.batches[0].requests[0].data.price, 1500000);
  assert.equal(rt.calls.batches[0].requests[0].data.currency, 'INR');
  assert(rt.calls.lookups.every(lookup => lookup.catalog === 'catalog'));
  assert.equal(new Set(rt.calls.lookups.map(lookup => lookup.id)).size, 242);
});

test('old sibling retailer IDs are repaired so every source variant has its own Meta identity', async () => {
  const rt = catalogRuntime([variant('first'), variant('second')], { existing: {
    first: { id: 'local-first', retailer_id: 'Sprinkler_second' },
    second: { id: 'local-second', retailer_id: 'Sprinkler_second' },
  } });
  const result = await rt.run();
  assert.equal(result.success, 2);
  const ids = rt.calls.batches[0].requests.map(request => request.retailer_id);
  assert.equal(new Set(ids).size, 2);
  assert(ids.includes('Sprinkler_first'));
  assert(ids.includes('Sprinkler_second'));
});

test('base64 source images are uploaded to stable public URLs before Meta receives them', async () => {
  const item = variant('image'); item.productImage = `data:image/webp;base64,${Buffer.from('fixture-image').toString('base64')}`;
  const rt = catalogRuntime([item]);
  const result = await rt.run();
  assert.equal(result.success, 1);
  assert.equal(rt.calls.uploads[0].buffer.toString(), 'fixture-image');
  assert.equal(rt.calls.uploads[0].metadata.metadata.contentType, 'image/webp');
  assert.match(rt.calls.batches[0].requests[0].data.image_url, /^https:\/\/storage.googleapis.com\/test-bucket\/products\/catalog\/[a-f0-9]{64}\.webp$/);
  assert.equal(rt.calls.saved[0].image_url, rt.calls.batches[0].requests[0].data.image_url);
});

test('variants sharing a base64 image share one upload, preventing Firebase metadata races', async () => {
  const image = `data:image/webp;base64,${Buffer.from('shared-fixture').toString('base64')}`;
  const rt = catalogRuntime([{ ...variant('one'), productImage: image }, { ...variant('two'), productImage: image }]);
  const result = await rt.run();
  assert.equal(result.success, 2);
  assert.equal(rt.calls.uploads.length, 1);
  const [one, two] = rt.calls.batches[0].requests;
  assert.equal(one.data.image_url, two.data.image_url);
});

test('browser blob images produce actionable failures and GST percentage strings are stored as JSON numbers', async () => {
  const rt = catalogRuntime([
    { ...variant('blob'), productImage: 'blob:https://admin.example.test/local-image' },
    { ...variant('gst'), gstRate: '5%' },
    { ...variant('blank-gst'), gstRate: '' },
  ]);
  const result = await rt.run();
  assert.equal(result.success, 2);
  assert.equal(result.failed, 1);
  assert.match(result.errors[0].error, /browser-only blob URL/);
  assert.match(result.errors[0].error, /product admin/);
  assert.equal(rt.calls.saved.find(row => row.variant_id === 'gst').gst, 5);
  assert.equal(rt.calls.saved.find(row => row.variant_id === 'blank-gst').gst, null);
});

test('catalog preflight errors stop all writes and unknown categories cannot fall back to an unrelated group', async () => {
  const error = new BadRequest({ message: 'Expired token', details: { code: 190 } });
  const failed = catalogRuntime([variant('item')], { preflightError: error });
  await assert.rejects(failed.run(), error => error.details.code === 190);
  assert.equal(failed.calls.saved.length, 0);
  const unrelated = catalogRuntime([{ ...variant('item'), categoryName: 'Unknown' }]);
  const result = await unrelated.run();
  assert.equal(result.failed, 1);
  assert.match(result.errors[0].error, /Category 'Unknown'/);
  assert.equal(unrelated.calls.batches.length, 0);
});

test('failed and pending batches persist truthful local states and result counters', async () => {
  for (const status of ['failed', 'pending']) {
    const rt = catalogRuntime([variant('item')], { status });
    const result = await rt.run();
    assert.equal(result.success, 0);
    assert.equal(result[status], 1);
    assert.equal(rt.calls.updated.at(-1).meta_status, status);
  }
});

test('sync API returns honest HTTP status and preserves actionable diagnostics', async () => {
  for (const [result, status, success] of [
    [{ total: 2, success: 2, failed: 0, pending: 0 }, 200, true],
    [{ total: 2, success: 0, failed: 2, pending: 0 }, 502, false],
    [{ total: 2, success: 1, failed: 1, pending: 0 }, 207, false],
    [{ total: 2, success: 0, failed: 0, pending: 2 }, 202, true],
  ]) {
    const controller = service('src/app/http/controllers/catalog.controller.ts', ['syncOrganizationVarinats'], {
      tryCatchAsync: fn => fn, catalogService: { syncOrganizationCatalog: async () => ({ ...result, message: 'Sync result' }) },
    });
    const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await controller.syncOrganizationVarinats({ body: {} }, response);
    assert.equal(response.code, status);
    assert.equal(response.body.success, success);
  }
  const controller = service('src/app/http/controllers/catalog.controller.ts', ['syncOrganizationVarinats'], {
    tryCatchAsync: fn => fn, catalogService: { syncOrganizationCatalog: async () => { throw new BadRequest({ message: 'Expired token', details: { code: 190 } }); } },
  });
  const response = { status() { return this; }, json(body) { this.body = body; } };
  await controller.syncOrganizationVarinats({ body: {} }, response);
  assert.equal(response.body.details.code, 190);
});
