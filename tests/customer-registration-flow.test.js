const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const logic = require('../src/app/services/chatbot/engine/condition.logic');
const { normalizeRegistrationPhoneNumber } = require('../src/phone');
const flow = require('../customer-registration.fixed.json');

// Use the real message builders and substitution functions without loading DB/email services.
const utilsSource = ts.createSourceFile('utils.ts', fs.readFileSync(path.join(__dirname, '../src/utils.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const functionNames = ['safeJSON', 'normalizeRole', 'normalizeLanguage', 'normalizeRegistrationData', 'replaceVariables', 'getNestedValue', 'replaceBodyVariables', 'buildWelcomeMessage', 'buildResponse'];
const functions = utilsSource.statements
  .filter(node => ts.isFunctionDeclaration(node) && functionNames.includes(node.name?.text))
  .map(node => node.getText(utilsSource).replace(/^export /, '')).join('\n');
const utils = vm.runInNewContext(ts.transpileModule(`${functions}\n({ replaceVariables, buildResponse });`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText, { console: { log() {} } });

function loadModule(file, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, {
    exports, URL, console: { log() {}, error() {} },
    require(name) { assert(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`); return mocks[name]; },
  });
  return exports;
}

function runtime(responses) {
  const requests = [];
  const session = { id: 'session', active: true, variables: { phone_number: '919372597458', role: 'FPO', gstin: 'INVALID', email: 'fpo@example.test' } };
  const model = { update: async (_id, data) => Object.assign(session, data) };
  const { executeNode } = loadModule('src/app/services/chatbot/engine/executeNode.ts', {
    axios: async request => {
      requests.push(request);
      assert(responses.length > 0, 'Unexpected extra API call (retry did not wait for an answer)');
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return { headers: {}, ...response };
    },
    '@surefy/console/app/models/chatSession.model': model,
    '@surefy/console/utils': { ...utils, normalizeRegistrationPhoneNumber },
    '@surefy/console/app/models/contactTag.model': {},
    '@surefy/console/app/models/contact.model': {},
    '@surefy/console/app/models/contactTagRelation.model': {},
    '@surefy/console/app/models/column.model': {},
    './condition.logic': logic,
  });
  const { menuFlow } = loadModule('src/app/services/chatbot/flows/menu.flow.ts', {
    '@surefy/console/app/models/chatSession.model': model,
    '@surefy/console/services/chatbot/engine/executeNode': { executeNode },
    '@surefy/console/utils': {},
    '../trigger.logic': require('../src/app/services/chatbot/trigger.logic'),
  });
  return {
    requests, session,
    run: node => executeNode({ bot: flow, session, currentNode: node }),
    answer: text => menuFlow({ bot: flow, session, incomingText: text, message: { type: 'text', text: { body: text } } }),
  };
}

const nodes = suffix => flow.nodes.filter(node => node.data.attributes?.url?.endsWith(suffix));
const texts = response => response?.messages ? response.messages.flatMap(texts) : [response?.text || ''];

test('registered FPO greeting uses a national lookup number, sends the configured message and ends', async () => {
  const first = flow.nodes.find(node => node.id === flow.edges.find(edge => edge.source === flow.nodes.find(node => node.type === 'trigger').id).target);
  const rt = runtime([{ status: 200, data: { success: true, message: 'User found', data: { user_id: 'fpo-id', role: 'fpo' } } }]);
  const response = await rt.run(first);
  assert.match(response.text, /User found/);
  assert.match(response.text, /already registered/);
  assert.doesNotMatch(response.text, /created successfully/);
  assert.equal(rt.requests[0].data.mobile_number, '9372597458');
  assert.equal(rt.session.variables.phone_number, '919372597458');
  assert.equal(rt.requests.length, 1);
  assert.equal(rt.session.active, false);
});

test('confirmed missing users reach language selection; lookup errors never start registration', async () => {
  const first = flow.nodes.find(node => node.data.title === 'Check registration on greeting');
  for (const body of [
    { success: false, message: 'User not found', data: null },
    { success: false, message: 'Database unavailable', data: null },
    { message: 'Unexpected result' },
  ]) {
    const rt = runtime([{ status: 200, data: body }]);
    const response = await rt.run(first);
    if (body.message === 'User not found') {
      assert.equal(response.type, 'interactive');
      assert.match(response.interactive.body.text, /language/);
    } else {
      assert.match(response.text, /could not check/);
      assert.equal(rt.session.active, false);
    }
    assert.equal(rt.requests.length, 1);
  }
});

test('each language treats success:true plus valid:false as invalid GST and waits for a replacement', async () => {
  for (const node of nodes('/verify-gstin')) {
    const body = { success: true, data: { status: 0, gstin: 'INVALID', valid: false } };
    const rt = runtime([{ status: 201, data: body }]);
    const response = await rt.run(node);
    assert.match(response.text, /GST number is invalid/);
    const current = flow.nodes.find(n => n.id === rt.session.current_node_id);
    assert.equal(current.data.key, '@whatsapp/ask-question');
    assert.equal(current.data.attributes.variable, 'gstin');
    assert.equal(rt.requests.length, 1);
    assert.equal(rt.session.variables.http_response, body);
    assert.equal(rt.session.active, true);
  }
});

test('validation messages from 2xx and opted-in 4xx responses are passed to the retry question', async () => {
  for (const status of [200, 400, 422]) {
    for (const node of nodes('/verify-gstin')) {
      const rt = runtime([{ status, data: { success: false, message: 'GSTIN is invalid or inactive', data: { valid: false } } }]);
      const response = await rt.run(node);
      assert.match(response.text, /GSTIN is invalid or inactive/);
      assert.equal(rt.requests.length, 1);
    }
  }
});

test('correcting GST in every language submits the new answer and registers exactly once', async () => {
  for (const node of nodes('/verify-gstin')) {
    const rt = runtime([
      { status: 201, data: { success: true, data: { valid: false } } },
      { status: 201, data: { success: true, data: { valid: true, gstin: 'CORRECTED', company_details: { legal_name: 'Example FPO' } } } },
      { status: 200, data: { success: true } },
    ]);
    await rt.run(node);
    const response = await rt.answer('CORRECTED');
    assert.equal(rt.requests[1].data.gstin, 'CORRECTED');
    assert.equal(rt.requests[2].data.session_data.gstin, 'CORRECTED');
    assert.equal(rt.requests[2].data.session_data.role, 'fpo');
    assert.equal(rt.requests[2].data.session_data.details.legal_name, 'Example FPO');
    assert.equal(rt.requests.length, 3);
    assert(!texts(response).some(text => text.includes('could not be completed')));
  }
});

test('successful FPO registration sends the full welcome details before the Excel prompt', async () => {
  for (const node of nodes('/verify-gstin')) {
    const company = { legal_name: 'KRISHIVAN TECHNOLOGIES PRIVATE LIMITED', pan: 'AAICK0914G' };
    const rt = runtime([
      { status: 201, data: { success: true, data: { valid: true, gstin: '29AAICK0914G1ZL', company_details: company } } },
      // The registration response replaces the GST response in http_response.
      { status: 200, data: { success: true, data: { id: 'stored', data: { details: company } } } },
    ]);
    rt.session.variables.gstin = '29AAICK0914G1ZL';
    rt.session.variables.email = 'parthvichare9@gmail.com';
    const messages = texts(await rt.run(node));
    const welcome = messages[0];
    for (const value of [
      '🌱 *Welcome to Krishivan!*',
      'Hello there,',
      'Your account has been created successfully. 🎉',
      '*Company:* KRISHIVAN TECHNOLOGIES PRIVATE LIMITED',
      '*Email:* parthvichare9@gmail.com',
      '*Phone:* 919372597458',
      '*GSTIN:* 29AAICK0914G1ZL',
      '*PAN:* AAICK0914G',
      '*Role:* FPO',
      'https://fpo-krishivan.web.app/login',
      '*Temporary password:* 123456',
      'Please change your password after your first login and keep your credentials private.',
      'Welcome aboard! 🤝',
    ]) assert(welcome.includes(value), `Missing welcome content: ${value}`);
    assert.doesNotMatch(welcome, /undefined|\[object Object\]|\{\{/);
    if (node.id === 'c3da7bb1-55fe-4d60-9545-8f698b5562aa') {
      assert.equal(messages.length, 2);
      assert.match(messages[1], /Import excel file/);
    }
  }
});

test('welcome uses stored registration details if top-level session fields are absent', async () => {
  const node = flow.nodes.find(n => n.data.attributes?.message?.text?.body === '{{registration_welcome}}');
  const response = await utils.buildResponse(node, { variables: {
    http_response: { data: { data: {
      name: 'Registered Person', email: 'member@example.test', phone_number: '919876543210',
      gstin: '29AAICK0914G1ZL', role: 'fpo',
      details: { legal_name: 'Example Company', pan: 'AAICK0914G' },
    } } },
  } });
  for (const value of ['Hello Registered Person,', '*Company:* Example Company', '*Email:* member@example.test',
    '*Phone:* 919876543210', '*GSTIN:* 29AAICK0914G1ZL', '*PAN:* AAICK0914G', '*Role:* FPO']) {
    assert(response.text.includes(value), `Missing stored registration detail: ${value}`);
  }
});

test('welcome follows Hindi or Telugu selection while retaining English company and account data', async () => {
  const node = flow.nodes.find(n => n.data.attributes?.message?.text?.body === '{{registration_welcome}}');
  for (const [language, selected, heading, confirmation, roleLabel] of [
    ['hindi', 'हिंदी', 'कृषिवन में आपका स्वागत है', 'आपका खाता सफलतापूर्वक बन गया है', 'भूमिका'],
    ['telugu', 'తెలుగు', 'కృషివన్‌కు స్వాగతం', 'మీ ఖాతా విజయవంతంగా సృష్టించబడింది', 'పాత్ర'],
  ]) {
    for (const source of ['selection', 'stored', 'user']) {
      const variables = {
        ...(source === 'selection' ? { native_language: selected } : {}),
        http_response: {
          ...(source === 'user' ? { user: { native_language: language } } : {}),
          data: { data: {
            native_language: source === 'stored' ? language : 'english', role: 'fpo',
            email: 'member@example.test', phone_number: '919876543210', gstin: '36AAICK0914G1ZQ',
            details: { legal_name: 'Example Company', pan: 'AAICK0914G' },
          } },
        },
      };
      const response = await utils.buildResponse(node, { variables });
      for (const value of [heading, confirmation, roleLabel, 'Example Company', 'member@example.test',
        '919876543210', '36AAICK0914G1ZQ', 'AAICK0914G', 'https://fpo-krishivan.web.app/login', '123456']) {
        assert(response.text.includes(value), `Missing ${language} welcome value: ${value}`);
      }
      assert.doesNotMatch(response.text, /Your account has been created successfully|undefined|\{\{/);
    }
  }
});

test('failed registration never sends success or requests the onboarding Excel file', async () => {
  for (const node of nodes('/verify-gstin')) {
    const rt = runtime([
      { status: 201, data: { success: true, data: { valid: true } } },
      { status: 200, data: { success: false, message: 'Registration unavailable' } },
    ]);
    const response = await rt.run(node);
    assert.match(response.text, /Registration could not be completed/);
    assert.match(response.text, /Registration unavailable/);
    assert.equal(rt.session.active, false);
    assert.equal(rt.requests.length, 2);
  }
});

test('GST server errors and network failures do not continue registration', async () => {
  for (const failure of [
    { status: 503, data: { success: false, message: 'Unavailable' } },
    Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }),
  ]) {
    const rt = runtime([failure]);
    const response = await rt.run(nodes('/verify-gstin')[0]);
    assert.match(response.text, /try again in a few minutes/);
    assert.equal(rt.requests.length, 1);
  }
});
