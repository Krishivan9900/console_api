const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const logic = require('../src/app/services/chatbot/trigger.logic');

function loadModule(file, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, {
    exports, process: { env: {} },
    console: { log() {}, info() {}, error(...args) { throw new Error(`Unexpected chatbot error: ${args}`); } },
    require(name) {
      assert(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
      return mocks[name];
    },
  });
  return exports;
}

function bot(id, keyword) {
  return {
    id, user_id: 'owner', flow_type: 'menu', trigger_word: keyword,
    nodes: [{ id: `${id}-trigger`, type: 'trigger' }, { id: `${id}-first`, type: 'action' }],
    edges: [{ source: `${id}-trigger`, target: `${id}-first` }],
  };
}

function runtime(candidates = [bot('bot', 'hii')], initialSessions = []) {
  const sessions = initialSessions.map(session => ({ ...session }));
  const calls = { lookups: [], menu: [], sent: [], restarted: [], deactivated: [] };
  const inScope = (session, args) => session.phone_number === args.phoneNumber &&
    session.phoneNumberId === args.phoneNumberId && session.chatbot_id === args.chatbotId && session.active;
  const chatSessionModel = {
    deactivateOtherBots: async (phone, number, id) => {
      calls.deactivated.push({ phone, number, id });
      sessions.filter(session => session.phone_number === phone && session.phoneNumberId === number && session.chatbot_id !== id)
        .forEach(session => { session.active = false; });
    },
    deactivateActiveSession: async args => {
      sessions.filter(session => inScope(session, args)).forEach(session => { session.active = false; });
    },
    findActiveSession: async args => sessions.find(session => inScope(session, args)),
    findActiveByPhoneNumberId: async (phone, number) => sessions.find(session => session.phone_number === phone && session.phoneNumberId === number && session.active),
    create: async data => { const session = { id: `created-${sessions.length}`, ...data }; sessions.push(session); return session; },
    update: async (id, data) => Object.assign(sessions.find(session => session.id === id), data),
  };
  const chatBotModel = { getPublishedBotByTrigger: async (_number, text) => logic.selectTriggeredBot(candidates, text) };
  const { triggerFlow } = loadModule('src/app/services/chatbot/flows/trigger.flow.ts', {
    '@surefy/console/app/models/chatSession.model': chatSessionModel,
    '@surefy/console/app/models/user.model': { findByPhone: async () => ({ id: 'fpo', user_id: 'external-fpo' }) },
    '@surefy/console/app/models/chatbot.model': chatBotModel,
    '../engine/executeNode': { executeNode: async data => {
      calls.restarted.push(data);
      return { type: 'text', text: 'Restarted', variables: data.session.variables };
    } },
  });
  const { flowRouter } = loadModule('src/app/services/chatbot/flow.router.ts', {
    '../../models/chatSession.model': chatSessionModel,
    './flows/trigger.flow': { triggerFlow },
    './flows/menu.flow': { menuFlow: async data => { calls.menu.push(data); return { type: 'text', text: 'Continued' }; } },
  });
  const { handleIncomingMessageChatBot } = loadModule('src/app/services/chatbot/chatbot.service.ts', {
    '@surefy/console/app/models/chatSession.model': chatSessionModel,
    './runtimeBot': { getRuntimeBot: async (number, id, text) => {
      calls.lookups.push({ number, id, text });
      return id ? candidates.find(candidate => candidate.id === id) : logic.selectTriggeredBot(candidates, text);
    } },
    '@surefy/console/services/message.service': { sendChatBotMessage: async (...args) => { calls.sent.push(args); } },
    nodemailer: { createTransport: () => ({}) },
    './flow.router': { flowRouter },
    '@surefy/console/models/contact.model': { findByPhone: async () => ({ id: 'contact' }) },
    '../../models/user.model': { findByPhone: async () => ({ id: 'fpo' }) },
    '../../models/phoneNumber.model': { findByPhoneNumberId: async () => ({ user_id: 'owner', company_id: 'company' }) },
    './trigger.logic': logic,
  });
  return { handleIncomingMessageChatBot, calls, sessions };
}

function activeSession(overrides = {}) {
  return {
    id: 'old-session', phone_number: 'customer', phoneNumberId: 'receiving-number', chatbot_id: 'bot',
    active: true, current_node_id: 'waiting-for-name', variables: { name: 'Old Name', parent_user_id: 'old-fpo' },
    ...overrides,
  };
}

test('keywords match text and phrases with case, whitespace, punctuation, and Unicode boundaries', () => {
  for (const [text, keyword] of [
    [' HII ', 'hii'], ['hii I want to register under 919372597458', 'hii'],
    ['I NEED   HELP!', 'need help'], ['Please restart.', 'restart'], ['नमस्ते दोस्त', 'नमस्ते'],
    ['Please use C++ now', 'C++'],
  ]) assert.equal(logic.matchesTriggerKeyword(text, keyword), true);
  for (const [text, keyword] of [['this', 'hi'], ['high', 'hi'], ['restartLater', 'restart'], ['', 'hi'], ['hello', '']]) {
    assert.equal(logic.matchesTriggerKeyword(text, keyword), false);
  }
});

test('exact messages and longer keywords select the correct chatbot deterministically', () => {
  const candidates = [bot('a', 'help'), bot('b', 'need help'), bot('c', 'hii')];
  assert.equal(logic.selectTriggeredBot(candidates, 'help').id, 'a');
  assert.equal(logic.selectTriggeredBot(candidates, 'I need help please').id, 'b');
  assert.equal(logic.selectTriggeredBot([bot('z', 'hii'), bot('a', 'hii')], 'hii').id, 'a');
  assert.equal(logic.selectTriggeredBot(candidates, 'ordinary answer'), null);
});

test('every supported incoming text format can restart an active chatbot', async () => {
  for (const message of [
    { type: 'text', text: { body: ' HII ' } },
    { type: 'interactive', interactive: { button_reply: { id: 'button-id', title: 'Hii' } } },
    { type: 'interactive', interactive: { list_reply: { id: 'row-id', title: 'Hii' } } },
    { type: 'button', button: { payload: 'template-button-id', text: 'Hii' } },
  ]) {
    const { handleIncomingMessageChatBot, calls, sessions } = runtime(undefined, [activeSession()]);
    const response = await handleIncomingMessageChatBot('receiving-number', { from: 'customer', ...message }, 'Customer');
    assert.equal(response.text, 'Restarted');
    assert.equal(calls.menu.length, 0);
    assert.equal(calls.restarted.length, 1);
    assert.equal(sessions[0].active, false);
    assert.equal(sessions[1].active, true);
    assert.equal(sessions[1].current_node_id, 'bot-first');
    assert.equal(response.variables.name, undefined);
    assert.equal(response.variables.parent_user_id, undefined);
    assert.equal(calls.sent.length, 1);
  }
});

test('keyword sentences restart before becoming answers and retain the FPO number', async () => {
  const { handleIncomingMessageChatBot, calls } = runtime(undefined, [activeSession()]);
  const response = await handleIncomingMessageChatBot('receiving-number', {
    from: 'customer', type: 'text', text: { body: 'hii I want to register under 919372597458' },
  }, 'Customer');
  assert.equal(response.text, 'Restarted');
  assert.equal(calls.menu.length, 0);
  assert.equal(response.variables.parent_user_id, 'fpo');
  assert.equal(response.variables.requested_fpo, '919372597458');
});

test('ordinary answers and unmatched buttons continue the current session', async () => {
  for (const message of [
    { type: 'text', text: { body: 'My name' } },
    { type: 'interactive', interactive: { button_reply: { id: 'button-id', title: 'Order products' } } },
    { type: 'button', button: { payload: 'legacy-id', text: 'Order products' } },
  ]) {
    const { handleIncomingMessageChatBot, calls, sessions } = runtime(undefined, [activeSession()]);
    assert.equal((await handleIncomingMessageChatBot('receiving-number', { from: 'customer', ...message }, 'Customer')).text, 'Continued');
    assert.equal(calls.restarted.length, 0);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].active, true);
    assert.equal(calls.menu[0].session.variables.name, 'Old Name');
    if (message.type === 'interactive') assert.equal(calls.menu[0].incomingId, 'button-id');
    if (message.type === 'button') assert.equal(calls.menu[0].incomingId, 'legacy-id');
  }
});

test('a keyword switches bots only for the same customer and receiving number', async () => {
  const oldSessions = [
    activeSession(),
    activeSession({ id: 'another-number', phoneNumberId: 'other-number' }),
    activeSession({ id: 'another-customer', phone_number: 'other-customer' }),
  ];
  const { handleIncomingMessageChatBot, sessions, calls } = runtime([bot('bot', 'hii'), bot('orders', 'order')], oldSessions);
  await handleIncomingMessageChatBot('receiving-number', { from: 'customer', type: 'text', text: { body: 'Order' } }, 'Customer');
  assert.equal(sessions[0].active, false);
  assert.equal(sessions[1].active, true);
  assert.equal(sessions[2].active, true);
  assert.equal(sessions[3].chatbot_id, 'orders');
  assert.equal(calls.restarted[0].currentNode.id, 'orders-first');
});

test('a keyword button can start a chatbot without an existing session', async () => {
  const { handleIncomingMessageChatBot, calls, sessions } = runtime();
  await handleIncomingMessageChatBot('receiving-number', { from: 'customer', type: 'interactive', interactive: { button_reply: { id: 'button', title: 'Hii' } } }, 'Customer');
  assert.equal(sessions.length, 1);
  assert.equal(calls.restarted.length, 1);
});

test('media without text does not look up keywords or restart the session', async () => {
  const { handleIncomingMessageChatBot, calls } = runtime(undefined, [activeSession()]);
  await handleIncomingMessageChatBot('receiving-number', { from: 'customer', type: 'location', location: { latitude: 12, longitude: 77 } }, 'Customer');
  assert.equal(calls.lookups.length, 1);
  assert.equal(calls.lookups[0].id, 'bot');
  assert.equal(calls.restarted.length, 0);
  assert.equal(calls.menu.length, 1);
});

test('database lookup restricts keyword candidates to published active bots on the receiving number', async () => {
  const filters = [];
  const rows = [
    { ...bot('wrong-number', 'hii'), phoneNumberId: 'other-number', active: true, published: true },
    { ...bot('inactive', 'hii'), phoneNumberId: 'receiving-number', active: false, published: true },
    { ...bot('draft', 'hii'), phoneNumberId: 'receiving-number', active: true, published: false },
    { ...bot('correct', 'hii'), phoneNumberId: 'receiving-number', active: true, published: true },
  ];
  class BaseModel {
    query() {
      const query = {
        select() { return query; }, join() { return query; },
        where(field, value) { filters.push([field, value]); return query; },
        then(resolve, reject) {
          return Promise.resolve(rows.filter(row => filters.every(([field, value]) =>
            row[{ 'chatbot_triggers.phone_number_id': 'phoneNumberId', 'chatbot_triggers.active': 'active', 'chat_bot.published': 'published' }[field]] === value
          ))).then(resolve, reject);
        },
      };
      return query;
    }
  }
  const model = loadModule('src/app/models/chatbot.model.ts', {
    '@surefy/models/base.model': { BaseModel },
    '../services/chatbot/trigger.logic': logic,
  }).default;
  assert.equal((await model.getPublishedBotByTrigger('receiving-number', 'hii I need help')).id, 'correct');
  assert.equal(filters.length, 3);
});
