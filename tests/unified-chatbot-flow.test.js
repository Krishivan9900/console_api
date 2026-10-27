const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { buildUnifiedFlow } = require('../scripts/build-unified-flow');
const flow = require('../krishivan-unified.flow.json');
const logic = require('../src/app/services/chatbot/engine/condition.logic');
const { normalizeRegistrationPhoneNumber } = require('../src/phone');
const { matchesTriggerKeyword } = require('../src/app/services/chatbot/trigger.logic');

function loadModule(file, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, {
    exports, URL, process: { env: {} }, console: { log() {}, info() {}, error() {} },
    require(name) { assert(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`); return mocks[name]; },
  });
  return exports;
}

function runtime({ registered = true, override, bot = flow } = {}) {
  bot = { id: 'bot', user_id: 'owner', flow_type: 'menu', ...bot };
  const requests = [];
  const catalogLookups = [];
  const downloads = [];
  let restarts = 0;
  const session = {
    id: 'session', chatbot_id: bot.id, active: true, phoneNumberId: '760184003848443',
    variables: { phone_number: '919372597458' },
  };
  const model = {
    update: async (_id, data) => Object.assign(session, data),
    findActiveByPhoneNumberId: async (phone, number) => session.active &&
      session.variables.phone_number === phone && session.phoneNumberId === number ? session : null,
    findActiveSession: async ({ phoneNumber, phoneNumberId, chatbotId }) => session.active &&
      session.variables.phone_number === phoneNumber && session.phoneNumberId === phoneNumberId &&
      session.chatbot_id === chatbotId ? session : null,
    deactivateActiveSession: async () => { session.active = false; },
    deactivateOtherBots: async () => {},
    create: async data => { restarts++; return Object.assign(session, data); },
  };
  const user = { id: 'registered-customer', role: 'farmer', deleted_at: null };
  const source = ts.createSourceFile('utils.ts', fs.readFileSync(path.join(__dirname, '../src/utils.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const names = ['safeJSON', 'normalizeRole', 'normalizeLanguage', 'getRegistrationLocation', 'getRegistrationEmail', 'normalizeRegistrationData', 'replaceVariables', 'getNestedValue', 'replaceBodyVariables', 'buildWelcomeMessage', 'buildResponse'];
  const functions = source.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text))
    .map(n => n.getText(source).replace(/^export /, '')).join('\n');
  const utils = vm.runInNewContext(ts.transpileModule(`${functions}\n({replaceVariables,buildResponse});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    console: { log() {} },
    catalogService: { getProductVariants: async (...args) => { catalogLookups.push(args); return { success: true, data: ['retailer-1'] }; } },
  });
  const { executeNode } = loadModule('src/app/services/chatbot/engine/executeNode.ts', {
    axios: async request => {
      requests.push(request);
      const custom = override?.(request);
      if (custom instanceof Error) throw custom;
      if (custom) return { headers: {}, ...custom };
      let data;
      if (request.url.endsWith('/check-user')) data = registered
        ? { success: true, data: user }
        : { success: false, message: 'User not found', data: null };
      else if (request.url.endsWith('/verify-gstin')) data = { success: true, data: {
        valid: true, gstin: '36AAICK0914G1ZQ', company_details: { legal_name: 'Example FPO', pan: 'AAICK0914G' },
      } };
      else if (request.url.endsWith('/stored-chat-session')) {
        registered = true;
        data = { success: true, data: { data: request.data.session_data } };
      } else if (request.url.endsWith('/check-category')) data = { success: true, data: ['retailer-1'] };
      else if (request.url.includes('/api/ai/')) data = { success: true, data: { answer: 'Example AI answer' } };
      else throw new Error(`Unexpected endpoint: ${request.url}`);
      return { status: 200, headers: {}, data };
    },
    '@surefy/console/app/models/chatSession.model': model,
    '@surefy/console/utils': { ...utils, normalizeRegistrationPhoneNumber },
    '@surefy/console/app/models/contactTag.model': {}, '@surefy/console/app/models/contact.model': {},
    '@surefy/console/app/models/contactTagRelation.model': {}, '@surefy/console/app/models/column.model': {},
    './condition.logic': logic,
  });
  const { menuFlow } = loadModule('src/app/services/chatbot/flows/menu.flow.ts', {
    '@surefy/console/app/models/chatSession.model': model,
    '@surefy/console/services/chatbot/engine/executeNode': { executeNode },
    '@surefy/console/utils': { downloadImage: async id => { downloads.push(id); return { firebaseUrl: 'https://example.test/upload.jpg' }; } },
    '../trigger.logic': require('../src/app/services/chatbot/trigger.logic'),
  });
  const { resumeAfterFpoLeadImport } = loadModule('src/app/services/chatbot/fpoImport.flow.ts', {
    '../../models/chatSession.model': model,
    './runtimeBot': { getRuntimeBot: async () => bot },
    './engine/executeNode': { executeNode },
  });
  const triggeredBot = text => require('../src/app/services/chatbot/trigger.logic').selectTriggeredBot(
    bot.nodes.find(n => n.type === 'trigger').data.attributes.keywords.map(trigger_word => ({ ...bot, trigger_word })), text);
  const { triggerFlow } = loadModule('src/app/services/chatbot/flows/trigger.flow.ts', {
    '@surefy/console/app/models/chatSession.model': model,
    '@surefy/console/app/models/user.model': { findByPhone: async () => null },
    '@surefy/console/app/models/chatbot.model': { getPublishedBotByTrigger: async (_number, text) => triggeredBot(text) },
    '../engine/executeNode': { executeNode },
  });
  const { flowRouter } = loadModule('src/app/services/chatbot/flow.router.ts', {
    '../../models/chatSession.model': model,
    './flows/trigger.flow': { triggerFlow }, './flows/menu.flow': { menuFlow },
  });
  const { handleIncomingMessageChatBot } = loadModule('src/app/services/chatbot/chatbot.service.ts', {
    '@surefy/console/app/models/chatSession.model': model,
    './runtimeBot': { getRuntimeBot: async (_number, botId, text) => botId ? bot : triggeredBot(text) },
    '@surefy/console/services/message.service': { sendChatBotMessage: async () => {} },
    nodemailer: { createTransport: () => ({}) }, './flow.router': { flowRouter },
    '@surefy/console/models/contact.model': { findByPhone: async () => ({ id: 'contact' }) },
    '../../models/user.model': { findByPhone: async () => null },
    '../../models/phoneNumber.model': { findByPhoneNumberId: async () => ({ user_id: 'owner', company_id: 'company' }) },
    './trigger.logic': require('../src/app/services/chatbot/trigger.logic'),
  });
  const current = () => bot.nodes.find(n => n.id === session.current_node_id);
  const reply = (value, button, media) => menuFlow({
    bot, session, incomingId: button?.id, incomingText: value.trim().toLowerCase(),
    message: media || (button
      ? { from: session.variables.phone_number, type: 'interactive', interactive: { button_reply: button } }
      : { from: session.variables.phone_number, type: 'text', text: { body: value } }),
  });
  return {
    requests, session, catalogLookups, downloads, current,
    restarts: () => restarts,
    receive: message => handleIncomingMessageChatBot(session.phoneNumberId, { from: session.variables.phone_number, ...message }, 'Customer'),
    run: n => executeNode({ bot, session, currentNode: n }),
    start: () => {
      const trigger = bot.nodes.find(n => n.type === 'trigger');
      return executeNode({ bot, session, currentNode: bot.nodes.find(n => n.id === bot.edges.find(e => e.source === trigger.id).target) });
    },
    answer: value => reply(value),
    image: () => reply('', null, { from: session.variables.phone_number, type: 'image', image: { id: 'uploaded-image' } }),
    location: () => reply('', null, { from: session.variables.phone_number, type: 'location', location: { latitude: 17.48, longitude: 78.53 } }),
    completeImport: (result = { success: true, imported_count: 3, failed_count: 0, role_counts: { farmer: 3 } }) =>
      resumeAfterFpoLeadImport({
        phoneNumberId: session.phoneNumberId, phone: session.variables.phone_number,
        document: { id: 'lead-upload', filename: 'leads.xlsx' }, result,
      }),
    click: value => {
      const action = current().data.attributes.message.interactive.action;
      const options = action.buttons?.map(b => b.reply) || action.sections.flatMap(s => s.rows);
      const option = typeof value === 'number' ? options[value] : options.find(o => o.id.endsWith(`/${value}`));
      assert(option, `Missing option ${value} on ${current().data.title}`);
      return reply(option.title, option);
    },
    staleClick: id => reply('Order / Booking', { id, title: 'Order / Booking' }),
  };
}

const messages = response => response?.messages ? response.messages.flatMap(messages) : [response];

test('actual incoming Order / Booking and AI services button messages advance without greeting or language restart', async () => {
  for (const language of ['en', 'hi', 'te']) {
    for (const option of ['booking', 'ai']) {
      const rt = runtime();
      await rt.start(); await rt.click(language);
      const selected = rt.current().data.attributes.message.interactive.action.buttons
        .find(b => b.reply.id.endsWith(`/${option}`)).reply;
      const response = await rt.receive({ type: 'interactive', interactive: { button_reply: selected } });
      assert.equal(rt.restarts(), 0);
      assert.equal(rt.session.active, true);
      assert(!messages(response).some(m => m?.text?.includes('Welcome back') ||
        m?.interactive?.body?.text?.includes('preferred language')));
      if (option === 'booking') {
        assert.equal(rt.current().data.attributes.variable, 'product_name');
        const catalog = await rt.receive({ type: 'text', text: { body: 'Tarpaulin' } });
        assert.equal(catalog.interactive.type, 'product_list');
      } else {
        assert.equal(rt.current().data.title, `AI services (${language})`);
        const chat = rt.current().data.attributes.message.interactive.action.buttons.find(b => b.reply.id.endsWith('/chat')).reply;
        const prompt = await rt.receive({ type: 'interactive', interactive: { button_reply: chat } });
        assert.equal(prompt.type, 'text');
        assert.equal(rt.current().data.attributes.variable, 'chat');
      }
    }
  }
});

test('previously saved service edges with only sourceHandle also follow the clicked booking connection', async () => {
  const saved = JSON.parse(JSON.stringify(flow));
  for (const edge of saved.edges) { delete edge.data.button_id; delete edge.sourceHandle; }
  const rt = runtime({ bot: saved });
  await rt.start(); await rt.click('en');
  await rt.receive({ type: 'interactive', interactive: { button_reply: { id: 'services/en/booking', title: 'Order / Booking' } } });
  assert.equal(rt.restarts(), 0);
  assert.equal(rt.current().data.attributes.variable, 'product_name');
});

test('stored flow is reproducible, uses one number, and has complete branch and button connections', () => {
  assert.deepEqual(flow, buildUnifiedFlow());
  assert.deepEqual(flow.phoneNumberIds, ['760184003848443']);
  const trigger = flow.nodes.find(n => n.type === 'trigger');
  assert.equal(flow.nodes.filter(n => n.type === 'trigger').length, 1);
  assert.deepEqual(trigger.data.attributes.receiverIds, flow.phoneNumberIds);
  for (const keyword of ['Hii', 'hello', 'services', 'order', 'booking', 'AI', 'menu', 'register']) {
    assert(trigger.data.attributes.keywords.some(k => matchesTriggerKeyword(keyword, k)));
  }
  const ids = new Set(flow.nodes.map(n => n.id));
  assert.equal(ids.size, flow.nodes.length);
  assert.equal(new Set(flow.edges.map(e => e.id)).size, flow.edges.length);
  for (const e of flow.edges) assert(ids.has(e.source) && ids.has(e.target), `Dangling edge ${e.id}`);
  for (const n of flow.nodes) {
    const outgoing = flow.edges.filter(e => e.source === n.id);
    if (n.data.key === '@condition/condition-action') {
      for (const branch of [true, false]) {
        assert.equal(new Set(outgoing.filter(e => logic.getConditionBranch(e) === branch).map(e => e.target)).size, 1, `${n.data.title}: ${branch}`);
      }
    }
    const a = n.data.attributes;
    if (a.url) assert(['console-api-z4hc.onrender.com', 'l07yapr0ub.execute-api.ap-south-1.amazonaws.com'].includes(new URL(a.url).host));
    const interactive = a.message?.interactive;
    const options = interactive?.action?.buttons?.map(b => ({ ...b.reply, limit: 20 })) ||
      interactive?.action?.sections?.flatMap(s => s.rows.map(r => ({ ...r, limit: 24 }))) || [];
    for (const option of options) {
      assert(option.title.length <= option.limit, `Long label ${option.title}`);
      assert.equal(outgoing.filter(e => e.data?.button_id === option.id).length, 1, `Missing or duplicate reply route ${option.id}`);
    }
  }
});

test('registered users skip registration and reach every language service menu', async () => {
  for (const language of ['en', 'hi', 'te']) {
    const rt = runtime();
    await rt.start();
    assert.equal(rt.current().data.title, 'Choose service language');
    await rt.click(language);
    assert.equal(rt.current().data.title, `Services (${language})`);
    assert.equal(rt.requests.length, 1);
    assert.equal(rt.requests[0].data.session_data, '919372597458');
    assert.equal(rt.session.phoneNumberId, '760184003848443');
  }
});

test('all roles register once in each language; FPOs complete Excel onboarding before services', async () => {
  for (const [languageIndex, language] of [[0, 'hi'], [1, 'en'], [2, 'te']]) {
    for (let roleIndex = 0; roleIndex < 8; roleIndex++) {
      const rt = runtime({ registered: false });
      await rt.start();
      assert.equal(rt.current().id, '3f7e0e2e-1ff7-4f43-8508-54747fbecb5d');
      await rt.click(languageIndex);
      await rt.click(roleIndex);
      if (roleIndex === 4) {
        assert.equal(rt.current().data.attributes.variable, 'gstin');
        assert.match(rt.current().data.attributes.message.text.body, /gst/i);
      }
      let response;
      let steps = 0;
      while (rt.current().data.attributes.variable !== 'excel_file' &&
        ['@whatsapp/ask-question', '@whatsapp/ask-location'].includes(rt.current().data.key)) {
        assert(++steps <= 8, 'Registration did not finish');
        const variable = rt.current().data.attributes.variable;
        if (variable === 'photo') response = await rt.image();
        else if (variable === 'location') response = await rt.location();
        else response = await rt.answer({ name: 'Test Customer', email: 'customer@example.test', gstin: '36AAICK0914G1ZQ' }[variable] || 'test');
      }
      if (roleIndex === 4) {
        assert.equal(rt.current().data.attributes.variable, 'excel_file');
        assert.equal(messages(response).at(-1).text, 'Please Import excel file for onboarding fpo leads');
        assert(!messages(response).some(m => m?.type === 'interactive'));
        assert.equal(rt.session.variables.email, undefined);
        await rt.completeImport();
      }
      assert.equal(rt.current().data.title, `Services (${language})`);
      const saves = rt.requests.filter(r => r.url.endsWith('/stored-chat-session'));
      assert.equal(saves.length, 1);
      assert.equal(saves[0].data.session_data.email, roleIndex === 4 ? undefined : 'customer@example.test');
      assert.equal(saves[0].data.session_data.native_language, { hi: 'hindi', en: 'english', te: 'telugu' }[language]);
      assert.equal(saves[0].data.session_data.role, ['farmer', 'trader', 'agricultural_transport_service', 'micro_entrepreneur',
        'fpo', 'agricultural_machinery_service_provider', 'agricultural_input_supplier', 'livestock_farmer'][roleIndex]);
      const confirmation = { en: 'created successfully', hi: 'आपका खाता सफलतापूर्वक बन गया है', te: 'మీ ఖాతా విజయవంతంగా సృష్టించబడింది' }[language];
      assert(messages(response).some(m => m?.text?.includes(confirmation)));
      assert.equal(rt.session.active, true);
    }
  }
});

test('the combined flow retries invalid GST and only opens services after corrected GST is saved', async () => {
  let gstChecks = 0;
  const rt = runtime({ registered: false, override: r => {
    if (r.url.endsWith('/verify-gstin') && ++gstChecks === 1) {
      return { status: 422, data: { success: false, message: 'GSTIN is invalid', data: { valid: false } } };
    }
  } });
  await rt.start(); await rt.click(1); await rt.click(4);
  const invalid = await rt.answer('INVALID');
  assert.match(invalid.text, /GSTIN is invalid/);
  assert.equal(rt.current().data.attributes.variable, 'gstin');
  assert(!rt.requests.some(r => r.url.endsWith('/stored-chat-session')));
  await rt.answer('36AAICK0914G1ZQ');
  assert.equal(rt.current().data.attributes.variable, 'excel_file');
  await rt.completeImport();
  assert.equal(rt.current().data.title, 'Services (en)');
  assert.equal(rt.requests.filter(r => r.url.endsWith('/stored-chat-session')).length, 1);
});

test('failed registration in the combined flow never sends a welcome or opens services', async () => {
  const rt = runtime({ registered: false, override: r => r.url.endsWith('/stored-chat-session')
    ? { status: 200, data: { success: false, message: 'Registration unavailable' } } : undefined });
  await rt.start(); await rt.click(1); await rt.click(4);
  const result = await rt.answer('36AAICK0914G1ZQ');
  assert.match(result.text, /Registration could not be completed/);
  assert.equal(rt.session.active, false);
  assert(!messages(result).some(m => m?.text?.includes('created successfully') || m?.type === 'interactive'));
});

test('FPO GST email reaches the Render request and localized welcome in every language', async () => {
  for (const languageIndex of [0, 1, 2]) {
    for (const topLevelEmail of [false, true]) {
      const rt = runtime({ registered: false, override: request => request.url.endsWith('/verify-gstin') ? {
        status: 201, data: { success: true, data: {
          valid: true, gstin: '36AAICK0914G1ZQ',
          ...(topLevelEmail ? { email: 'gst-contact@example.test' } : {}),
          company_details: { legal_name: 'Example FPO', ...(topLevelEmail ? {} : { email: 'gst-contact@example.test' }) },
        } },
      } : undefined });
      await rt.start(); await rt.click(languageIndex); await rt.click(4);
      assert.equal(rt.current().data.attributes.variable, 'gstin');
      const response = await rt.answer('36AAICK0914G1ZQ');
      const saved = rt.requests.find(request => request.url.endsWith('/stored-chat-session'));
      assert.equal(saved.url, 'https://console-api-z4hc.onrender.com/v1/auth/stored-chat-session');
      assert.equal(saved.data.session_data.email, 'gst-contact@example.test');
      assert(messages(response).some(message => message?.text?.includes('gst-contact@example.test')));
      assert.equal(rt.current().data.attributes.variable, 'excel_file');
    }
  }
});

test('lookup failures never start registration or services', async () => {
  for (const response of [
    { status: 200, data: { success: false, message: 'Database unavailable' } },
    { status: 200, data: { success: true, data: {} } },
    { status: 200, data: { success: true, data: { id: 'deleted', deleted_at: '2026-01-01' } } },
    { status: 503, data: { success: false } },
  ]) {
    const rt = runtime({ override: () => response });
    const result = await rt.start();
    assert.equal(result.type, 'text');
    assert.equal(rt.requests.length, 1);
    assert.notEqual(rt.current()?.data.title, 'Choose service language');
  }
});

test('a stale booking button rechecks the database before allowing service access', async () => {
  const rt = runtime({ registered: false });
  await rt.start();
  await rt.staleClick('services/en/booking');
  assert.equal(rt.current().id, '3f7e0e2e-1ff7-4f43-8508-54747fbecb5d');
  assert.equal(rt.requests.length, 2);
  assert(rt.requests.every(r => r.url.endsWith('/check-user')));
});

test('booking searches the existing catalog and waits for the native WhatsApp cart in each language', async () => {
  for (const language of ['en', 'hi', 'te']) {
    const rt = runtime();
    await rt.start(); await rt.click(language); await rt.click('booking');
    assert.equal(rt.current().data.attributes.variable, 'product_name');
    const response = await rt.answer('Tarpaulin');
    const search = rt.requests.at(-1);
    assert.equal(search.url, 'https://console-api-z4hc.onrender.com/v1/auth/check-category');
    assert.equal(search.data.session_data.category, 'tarpaulin');
    assert.equal(response.interactive.type, 'product_list');
    assert.equal(response.interactive.action.catalog_id, '795853123055079');
    assert.equal(response.interactive.action.sections[0].product_items[0].product_retailer_id, 'retailer-1');
    assert.equal(rt.session.active, true);
    assert(!rt.requests.some(r => r.url.endsWith('/stored-chat-session')));
  }
});

test('no product matches wait for another name; catalog outages return to services', async () => {
  for (const outage of [false, true]) {
    const rt = runtime({ override: r => r.url.endsWith('/check-category') ? {
      status: outage ? 404 : 200,
      data: { success: false, message: outage ? 'Route not found' : 'No matching product variants found' },
    } : undefined });
    await rt.start(); await rt.click('en'); await rt.click('booking');
    const response = await rt.answer('Unknown product');
    assert.equal(rt.current().data.title, outage ? 'Services (en)' : 'Try another product (en)');
    assert(!messages(response).some(m => m?.interactive?.type === 'product_list'));
  }
});

test('AI chat and image requests send the answer or uploaded image without re-registering customers', async () => {
  for (const language of ['en', 'hi', 'te']) {
    for (const kind of ['chat', 'image']) {
      const rt = runtime();
      await rt.start(); await rt.click(language); await rt.click('ai'); await rt.click(kind);
      const result = kind === 'chat' ? await rt.answer('Please help with my crop') : await rt.image();
      const request = rt.requests.at(-1);
      assert.equal(request.url, `https://console-api-z4hc.onrender.com/api/ai/${kind === 'chat' ? 'chat' : 'image-detection'}`);
      assert.equal(request.data.data[kind === 'chat' ? 'chat' : 'image_url'], kind === 'chat' ? 'please help with my crop' : 'https://example.test/upload.jpg');
      assert(messages(result).some(m => m?.text === 'Example AI answer'));
      assert.equal(rt.current().data.title, `Services (${language})`);
      assert(!rt.requests.some(r => r.url.endsWith('/stored-chat-session')));
      assert.equal(rt.session.active, true);
    }
  }
});

test('missing AI routes show unavailable and return to the menu without claiming success', async () => {
  const rt = runtime({ override: r => r.url.includes('/api/ai/')
    ? { status: 404, data: { success: false, error: { message: 'Route not found' } } } : undefined });
  await rt.start(); await rt.click('en'); await rt.click('ai'); await rt.click('chat');
  const result = await rt.answer('Help');
  assert(messages(result).some(m => m?.text?.includes('currently unavailable')));
  assert(!messages(result).some(m => m?.text?.includes('resolved your issue')));
  assert.equal(rt.current().data.title, 'Services (en)');
});

test('the existing FPO import option waits for Excel and continues to the same services menu', async () => {
  const rt = runtime();
  await rt.start(); await rt.click('en');
  const result = await rt.click('import');
  assert.equal(result.text, 'Please Import excel file for onboarding fpo leads');
  assert.equal(rt.current().data.attributes.variable, 'excel_file');
  assert(rt.requests.every(r => r.url.endsWith('/check-user')));
  await rt.completeImport();
  assert.equal(rt.current().data.title, 'Services (en)');
  assert.equal(rt.session.variables.excel_file.filename, 'leads.xlsx');
  assert.equal(rt.session.variables.fpo_import_result.imported_count, 3);
});

test('ordinary text and failed or partial imports leave the upload question waiting', async () => {
  const rt = runtime();
  await rt.start(); await rt.click('en'); await rt.click('import');
  const waitingId = rt.current().id;
  const reminder = await rt.answer('done');
  assert.match(reminder.text, /upload the completed Excel/);
  assert.equal(rt.current().id, waitingId);
  for (const result of [
    { success: false, imported_count: 0, failed_count: 3 },
    { success: false, imported_count: 2, failed_count: 1 },
    { success: true, imported_count: 0, failed_count: 0 },
  ]) {
    assert.equal(await rt.completeImport(result), null);
    assert.equal(rt.current().id, waitingId);
  }
  assert.equal(rt.session.variables.excel_file, undefined);
});

test('an import completed outside an upload question does not interrupt booking', async () => {
  const rt = runtime();
  await rt.start(); await rt.click('en'); await rt.click('booking');
  const waitingId = rt.current().id;
  assert.equal(await rt.completeImport(), null);
  assert.equal(rt.current().id, waitingId);
});

test('button routing still works after node IDs are remapped and edge handles are stored only in JSON', async () => {
  const saved = JSON.parse(JSON.stringify(flow));
  for (const n of saved.nodes) n.id = `saved-${n.id}`;
  for (const e of saved.edges) {
    e.source = `saved-${e.source}`; e.target = `saved-${e.target}`;
    delete e.sourceHandle; delete e.targetHandle;
  }
  const rt = runtime({ bot: saved });
  await rt.start(); await rt.click('en'); await rt.click('booking');
  assert.equal(rt.current().data.attributes.variable, 'product_name');
  assert.equal(rt.requests.length, 2);
});
