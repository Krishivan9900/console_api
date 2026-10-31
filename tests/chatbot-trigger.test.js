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
    nodes: [{ id: `${id}-trigger`, type: 'trigger' }, { id: `${id}-first`, type: 'action' },
      { id: 'waiting-for-name', data: { key: '@whatsapp/ask-question' } }],
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
  const availableBots = number => candidates.filter(candidate =>
    candidate.published !== false && candidate.active !== false && (candidate.phoneNumberId || 'receiving-number') === number);
  const chatBotModel = {
    getPublishedBotByTrigger: async (number, text) => logic.selectTriggeredBot(availableBots(number), text),
    getPublishedBotByPhoneNumber: async (number, id) => availableBots(number).find(candidate => !id || candidate.id === id),
  };
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
      return id ? chatBotModel.getPublishedBotByPhoneNumber(number, id)
        : text ? chatBotModel.getPublishedBotByTrigger(number, text) : chatBotModel.getPublishedBotByPhoneNumber(number);
    } },
    '@surefy/console/services/message.service': { sendChatBotMessage: async (...args) => { calls.sent.push(args); } },
    nodemailer: { createTransport: () => ({}) },
    './flow.router': { flowRouter },
    '@surefy/console/models/contact.model': { findByPhone: async () => ({ id: 'contact' }) },
    '../../models/user.model': { findByPhone: async () => ({ id: 'fpo' }) },
    '../../models/phoneNumber.model': { findByPhoneNumberId: async () => ({ user_id: 'owner', company_id: 'company' }) },
    './trigger.logic': logic,
  });
  return { handleIncomingMessageChatBot, triggerFlow, calls, sessions };
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

test('saved service replies take priority over matching order, booking and AI trigger keywords', async () => {
  for (const [kind, title, replyId, edgeData] of [
    ['button', 'Order / Booking', 'services/en/booking', { button_id: 'services/en/booking' }],
    ['button', 'AI services', 'services/en/ai', { sourceHandle: 'services/en/ai' }],
    ['list', 'Order products', 'saved-order-row', { sourceHandle: 'saved-order-row' }],
    ['template', 'Order / Booking', 'saved-order-button', { button_id: 'saved-order-button' }],
  ]) {
    const serviceBot = bot('bot', 'order');
    serviceBot.nodes.push({ id: 'services-menu', data: { key: kind === 'list' ? '@whatsapp/send-list-message' : '@whatsapp/send-button-message' } });
    serviceBot.edges.push({ source: 'services-menu', target: 'booking', data: edgeData });
    const candidates = [serviceBot, { ...serviceBot, trigger_word: 'booking' }, { ...serviceBot, trigger_word: 'ai' },
      bot('alternate-order-bot', 'order'), bot('alternate-ai-bot', 'ai')];
    const { handleIncomingMessageChatBot, calls, sessions } = runtime(candidates, [activeSession({ current_node_id: 'services-menu' })]);
    const message = kind === 'template'
      ? { type: 'button', button: { payload: replyId, text: title } }
      : { type: 'interactive', interactive: { [kind === 'list' ? 'list_reply' : 'button_reply']: { id: replyId, title } } };
    const result = await handleIncomingMessageChatBot('receiving-number', { from: 'customer', ...message }, 'Customer');
    assert.equal(result.text, 'Continued');
    assert.equal(calls.restarted.length, 0);
    assert.equal(calls.menu[0].incomingId, replyId);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].active, true);
    assert.equal(calls.deactivated.length, 0);
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

test('any non-empty first text starts a published flow without changing its saved keywords', async () => {
  for (const text of ['Good morning', 'What products do you sell?', 'नमस्ते', 'నమస్కారం', '👍', '1234567890']) {
    const { handleIncomingMessageChatBot, calls, sessions } = runtime();
    const response = await handleIncomingMessageChatBot('receiving-number', { from: 'customer', type: 'text', text: { body: text } }, 'Customer');
    assert.equal(response.text, 'Restarted', text);
    assert.equal(calls.restarted.length, 1);
    assert.equal(calls.sent.length, 1);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].chatbot_id, 'bot');
    assert.equal(sessions[0].variables.requested_fpo, undefined, 'an arbitrary numeric first message is not an FPO referral');
  }
});

test('unmatched first text prefers the active flow over starting another chatbot', async () => {
  const { handleIncomingMessageChatBot, calls, sessions } = runtime([bot('default', 'hi'), bot('bot', 'hii')], [activeSession()]);
  const response = await handleIncomingMessageChatBot('receiving-number', {
    from: 'customer', type: 'text', text: { body: 'Ramesh Kumar' },
  }, 'Customer');
  assert.equal(response.text, 'Continued');
  assert.equal(calls.menu[0].bot.id, 'bot');
  assert.equal(calls.restarted.length, 0);
  assert.equal(sessions.length, 1);
});

test('any text restarts after a completed session and repairs a session pointing to a removed node', async () => {
  for (const old of [activeSession({ active: false }), activeSession({ current_node_id: 'removed-node' })]) {
    const { handleIncomingMessageChatBot, calls, sessions } = runtime(undefined, [old]);
    const result = await handleIncomingMessageChatBot('receiving-number', {
      from: 'customer', type: 'text', text: { body: 'I would like assistance' },
    }, 'Customer');
    assert.equal(result.text, 'Restarted');
    assert.equal(calls.restarted.length, 1);
    assert.equal(sessions[0].active, false);
    assert.equal(sessions[1].active, true);
  }
});

test('blank text, unmatched button replies and media do not start a fresh fallback flow', async () => {
  for (const message of [
    { type: 'text', text: { body: '  ' } },
    { type: 'interactive', interactive: { button_reply: { id: 'stale', title: 'Unknown option' } } },
    { type: 'image', image: { id: 'image' } },
    { type: 'location', location: { latitude: 12, longitude: 77 } },
    { type: 'reaction', reaction: { emoji: '👍' } },
  ]) {
    const { handleIncomingMessageChatBot, calls, sessions } = runtime();
    assert.equal(await handleIncomingMessageChatBot('receiving-number', { from: 'customer', ...message }, 'Customer'), null);
    assert.equal(calls.restarted.length, 0);
    assert.equal(sessions.length, 0);
  }
});

test('fallback starts are restricted to published active flows on the receiving number', async () => {
  for (const candidates of [[], [bot('other-number', 'hi')].map(b => ({ ...b, phoneNumberId: 'other-number' })),
    [{ ...bot('draft', 'hi'), published: false }], [{ ...bot('inactive', 'hi'), active: false }]]) {
    const { handleIncomingMessageChatBot, calls } = runtime(candidates);
    assert.equal(await handleIncomingMessageChatBot('receiving-number', { from: 'customer', type: 'text', text: { body: 'Anything' } }, 'Customer'), null);
    assert.equal(calls.restarted.length, 0);
  }
  const rt = runtime([{ ...bot('other-number', 'hi'), phoneNumberId: 'other-number' }]);
  assert.equal(await rt.triggerFlow({ bot: bot('other-number', 'hi'), phone: 'customer',
    phoneNumberId: 'receiving-number', incomingText: 'Anything', startOnAnyText: true }), null);
  assert.equal(rt.calls.restarted.length, 0);
});

test('runtime loads and hydrates the receiving number default only when no keyword lookup was requested', async () => {
  const calls = [];
  const model = {
    getPublishedBotByTrigger: async (number, text) => { calls.push(['keyword', number, text]); return null; },
    getPublishedBotByPhoneNumber: async (number, id) => { calls.push(['number', number, id]); return bot('default', 'hi'); },
  };
  const { getRuntimeBot } = loadModule('src/app/services/chatbot/runtimeBot.ts', {
    '../../models/chatbot.model': model,
    '../../models/chatBotNode.model': { findByChatBotId: async () => [{ id: 'trigger', data: JSON.stringify({ attributes: { keywords: ['hi'] } }) }] },
    '../../models/chatBotEdge.model': { findByChatBotId: async () => [{ source: 'trigger', data: '{}' }] },
  });
  assert.equal(await getRuntimeBot('receiving-number', undefined, 'unknown'), null);
  const fallback = await getRuntimeBot('receiving-number');
  assert.equal(fallback.id, 'default');
  assert.equal(fallback.nodes[0].data.attributes.keywords[0], 'hi');
  assert.deepEqual(calls, [['keyword', 'receiving-number', 'unknown'], ['number', 'receiving-number', undefined]]);
});

test('database fallback selects the newest published active non-deleted bot only on the receiving number', async () => {
  const rows = [
    { id: 'newest-other-number', phoneNumberId: 'other-number', active: true, published: true, updated_at: 10 },
    { id: 'draft', phoneNumberId: 'receiving-number', active: true, published: false, updated_at: 9 },
    { id: 'inactive', phoneNumberId: 'receiving-number', active: false, published: true, updated_at: 8 },
    { id: 'deleted', phoneNumberId: 'receiving-number', active: true, published: true, deleted_at: 'deleted', updated_at: 7 },
    { id: 'older', phoneNumberId: 'receiving-number', active: true, published: true, updated_at: 1 },
    { id: 'latest', phoneNumberId: 'receiving-number', active: true, published: true, updated_at: 3 },
  ];
  const fields = { 'chatbot_triggers.phone_number_id': 'phoneNumberId', 'chatbot_triggers.active': 'active',
    'chat_bot.published': 'published', 'chat_bot.id': 'id', 'chat_bot.deleted_at': 'deleted_at', 'chat_bot.updated_at': 'updated_at' };
  class BaseModel {
    query() {
      const filters = [], order = [];
      const query = {
        select() { return query; }, join() { return query; },
        where(field, value) { filters.push(row => row[fields[field]] === value); return query; },
        whereNull(field) { filters.push(row => row[fields[field]] == null); return query; },
        orderBy(field, direction) { order.push([fields[field], direction]); return query; },
        first() { return rows.filter(row => filters.every(filter => filter(row))).sort((a, b) => {
          for (const [field, direction] of order) {
            const comparison = typeof a[field] === 'number' ? a[field] - b[field] : a[field].localeCompare(b[field]);
            if (comparison) return direction === 'desc' ? -comparison : comparison;
          }
          return 0;
        })[0]; },
      };
      return query;
    }
  }
  const model = loadModule('src/app/models/chatbot.model.ts', {
    '@surefy/models/base.model': { BaseModel }, '../services/chatbot/trigger.logic': logic,
  }).default;
  assert.equal((await model.getPublishedBotByPhoneNumber('receiving-number')).id, 'latest');
  assert.equal((await model.getPublishedBotByPhoneNumber('receiving-number', 'older')).id, 'older');
  assert.equal(await model.getPublishedBotByPhoneNumber('missing-number'), undefined);
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
