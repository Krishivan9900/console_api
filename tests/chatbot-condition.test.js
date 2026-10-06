const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const logic = require('../src/app/services/chatbot/engine/condition.logic');

// Load the real runtime with external services stubbed so tests never contact a database or WhatsApp.
function loadModule(file, mocks) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    console: { log() {}, error() {} },
    require(name) {
      assert(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
      return mocks[name];
    },
  });
  return exports;
}

function runtime() {
  const updates = [];
  const { executeNode } = loadModule('src/app/services/chatbot/engine/executeNode.ts', {
    axios: () => { throw new Error('Unexpected HTTP request'); },
    '@surefy/console/app/models/chatSession.model': { update: async (id, data) => updates.push({ id, ...data }) },
    '@surefy/console/utils': { buildResponse: async (node, session) => ({ type: 'text', text: node.id, variables: session.variables }) },
    '@surefy/console/app/models/contactTag.model': {},
    '@surefy/console/app/models/contact.model': {},
    '@surefy/console/app/models/contactTagRelation.model': {},
    '@surefy/console/app/models/column.model': {},
    './condition.logic': logic,
  });
  return { executeNode, updates };
}

function fixture(attributes, variables = {}) {
  const currentNode = { id: 'condition', data: { key: '@condition/condition-action', attributes } };
  return {
    currentNode,
    session: { id: 'session', variables },
    bot: {
      nodes: [currentNode, { id: 'true-message', data: { key: '@test/message' } }, { id: 'false-message', data: { key: '@test/message' } }],
      edges: [
        { source: 'condition', target: 'true-message', data: { sourceHandle: 'condition-true-old-editor-id' } },
        { source: 'condition', target: 'false-message', data: { sourceHandle: 'condition-false-old-editor-id' } },
      ],
    },
  };
}

test('configured parent_user_id condition overrides successful HTTP result and preserves null', async () => {
  const { executeNode, updates } = runtime();
  const input = fixture({ variable: 'parent_user_id', conditions: [{ field: '{{parent_user_id}}', comparator: 'is_not_empty' }] }, {
    http_response: { success: true, data: { parent_user_id: null } },
    parent_user_id: 'previous-parent',
    user_id: 'bot-owner',
    data: { previous: 'keep' },
    details: { name: 'Existing name', location: { latitude: 12 } },
  });
  const response = await executeNode(input);
  assert.equal(response.text, 'false-message');
  assert.equal(response.variables.parent_user_id, null);
  assert.equal(response.variables.details.parent_user_id, null);
  assert.equal(response.variables.user_id, 'bot-owner');
  assert.equal(response.variables.details.name, 'Existing name');
  assert.equal(response.variables.details.location.latitude, 12);
  assert.equal(response.variables.data.previous, 'keep');
  assert.equal(updates[0].current_node_id, 'false-message');
});

test('extracted HTTP variable persists and routes through explicit true metadata', async () => {
  const { executeNode } = runtime();
  const input = fixture({ variable: 'parent_user_id', conditions: [{ field: 'parent_user_id', comparator: 'equals', value: 'parent-1' }] }, {
    http_response: { success: false, data: { parent_user_id: 'parent-1' } },
  });
  input.bot.edges[0].data = { condition: true };
  const response = await executeNode(input);
  assert.equal(response.text, 'true-message');
  assert.equal(response.variables.parent_user_id, 'parent-1');
  assert.equal(response.variables.details.parent_user_id, 'parent-1');
});

test('nested response fields and variable references work with AND and OR', () => {
  const rules = [
    { field: '{{http_response.data.valid}}', comparator: 'equals', value: 'TRUE' },
    { field: 'count', comparator: 'greater_than', value: '{{minimum}}' },
  ];
  const variables = { http_response: { data: { valid: true } }, count: 2, minimum: 3 };
  assert.equal(logic.evaluateConditions({ conditions: rules, operator: 'and' }, variables), false);
  assert.equal(logic.evaluateConditions({ conditions: rules, operator: 'OR' }, variables), true);
});

test('null, missing fields, false, zero, and nonnumeric values have predictable comparisons', () => {
  const check = (comparator, actual, value) => logic.evaluateConditions({ conditions: [{ field: 'value', comparator, value }] }, { value: actual });
  assert.equal(check('equals', null, null), true);
  assert.equal(check('equals', undefined, ''), false);
  assert.equal(check('exists', false), true);
  assert.equal(check('is_empty', undefined), true);
  assert.equal(check('is_not_empty', 0), true);
  assert.equal(check('not_equals', 'a', 'b'), true);
  assert.equal(check('greater_than_or_equal', '10', 10), true);
  assert.equal(check('less_than', '2', '10'), true);
  assert.equal(check('less_than_or_equal', 2, 2), true);
  assert.equal(check('greater_than', 'invalid', 1), false);
  assert.equal(check('greater_than', null, -1), false);
  assert.equal(check('contains', ['One', 'Two'], 'one'), true);
  assert.equal(check('not_contains', 'Hello', 'world'), true);
  assert.equal(check('starts_with', 'Hello', 'he'), true);
  assert.equal(check('ends_with', 'Hello', 'LO'), true);
  assert.equal(logic.getConditionValue({}, '__proto__.polluted'), undefined);
});

test('legacy flows without configured rules branch on HTTP success', async () => {
  for (const success of [true, false]) {
    const { executeNode } = runtime();
    const response = await executeNode(fixture({ conditions: [] }, { http_response: { success } }));
    assert.equal(response.text, `${success}-message`);
  }
});

test('supported saved branch formats include booleans, handles, labels, and JSON data', () => {
  for (const branch of [true, false]) {
    for (const edge of [
      { data: { condition: branch } },
      { data: { condition: String(branch) } },
      { data: { branch: String(branch) } },
      { sourceHandle: `condition-${branch}-editor-id` },
      { data: { sourceHandle: `condition-${branch}-editor-id` } },
      { label: String(branch) },
      { data: JSON.stringify({ condition: branch }) },
    ]) assert.equal(logic.getConditionBranch(edge), branch);
  }
  assert.equal(logic.getConditionBranch({ data: {}, label: 'Continue' }), undefined);
});

test('missing, ambiguous, or dangling branches produce a message and close the session', async () => {
  for (const problem of ['missing', 'ambiguous', 'dangling']) {
    const { executeNode, updates } = runtime();
    const input = fixture({}, { http_response: { success: true } });
    if (problem === 'missing') input.bot.edges = [];
    if (problem === 'ambiguous') input.bot.edges.push({ ...input.bot.edges[0], target: 'false-message' });
    if (problem === 'dangling') input.bot.edges[0].target = 'deleted-node';
    const response = await executeNode(input);
    assert.equal(response.type, 'text');
    assert.match(response.text, /could not continue/);
    assert.equal(updates.at(-1).active, false);
    assert.equal(updates.at(-1).current_node_id, null);
  }
});

test('flow editor success alias routes duplicate copies of a branch to one destination', async () => {
  for (const success of [true, false]) {
    const { executeNode, updates } = runtime();
    const input = fixture({ conditions: [{ field: '{{http_response_success}}', comparator: 'equals', value: 'true' }] }, {
      http_response: { success, data: { parent_user_id: null } },
    });
    for (const branch of [true, false]) {
      input.bot.edges.push(
        { source: 'condition', target: `${branch}-message`, sourceHandle: 'default', label: String(branch), data: {} },
        { source: 'condition', target: `${branch}-message`, data: { condition: String(branch) } },
      );
    }
    const response = await executeNode(input);
    assert.equal(response.text, `${success}-message`);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].current_node_id, `${success}-message`);
  }
  assert.equal(logic.getConditionValue({ http_response_success: true, http_response: { success: false } }, '{{http_response_success}}'), false);
  assert.equal(logic.evaluateConditions({ conditions: [{ field: '{{http_response_success}}', comparator: 'equals', value: '' }] }, { http_response: { success: true } }), false);
});

test('unsupported or malformed conditions report failure without taking a branch', async () => {
  for (const attributes of [
    { conditions: [{ field: 'value', comparator: 'unknown' }] },
    { conditions: [{ comparator: 'equals' }] },
    { conditions: 'invalid' },
    { operator: 'invalid', conditions: [{ field: 'value', comparator: 'equals', value: 1 }] },
  ]) {
    const { executeNode, updates } = runtime();
    const response = await executeNode(fixture(attributes, { value: 1 }));
    assert.match(response.text, /could not continue/);
    assert.equal(updates[0].active, false);
  }
});

test('saving flows persists handles and condition branch metadata after node IDs change', async () => {
  let savedEdges;
  let nextId = 0;
  const service = loadModule('src/app/services/chatbot.service.ts', {
    '@surefy/exceptions/HTTP400Error': Error,
    '../models/chatbot.model': { findById: async () => ({ published: false }), update: async () => {} },
    '../models/chatBotEdge.model': { deleteChatBotEdge: async () => {}, createEdges: async edges => { savedEdges = edges; } },
    '../models/chatBotNode.model': { deleteChatBotNode: async () => {}, createNodes: async () => {} },
    '../models/chatbotTrigger.model': { findConflicts: async () => [], deleteByChatBot: async () => {}, createMany: async () => {} },
    uuid: { v4: () => `new-${++nextId}` },
    './chatbot/engine/condition.logic': logic,
  }).default;
  await service.createFlow('owner', {
    chatBotId: 'bot', phoneNumberIds: ['phone-id'],
    nodes: [
      { id: 'trigger', type: 'trigger', data: { attributes: { keywords: ['hi'] } } },
      { id: 'condition', data: { key: '@condition/condition-action' } },
      { id: 'message', type: 'message', data: {} },
    ],
    edges: [
      { source: 'condition', target: 'message', sourceHandle: 'condition-true-condition', targetHandle: 'input', data: { custom: 'keep' } },
      { source: 'condition', target: 'message', data: { sourceHandle: 'condition-false-condition' } },
      { source: 'trigger', target: 'condition', sourceHandle: 'output', data: JSON.stringify({ action: 'keep' }) },
    ],
  });
  const trueData = JSON.parse(savedEdges[0].data);
  assert.equal(trueData.condition, true);
  assert.equal(trueData.sourceHandle, `condition-true-${savedEdges[0].source}`);
  assert.equal(trueData.targetHandle, 'input');
  assert.equal(trueData.custom, 'keep');
  const falseData = JSON.parse(savedEdges[1].data);
  assert.equal(falseData.condition, false);
  assert.equal(falseData.sourceHandle, `condition-false-${savedEdges[1].source}`);
  assert.equal(JSON.parse(savedEdges[2].data).action, 'keep');
  assert.equal(JSON.parse(savedEdges[2].data).sourceHandle, 'output');
});

test('saving a flow rejects blank HTTP success comparisons and conflicting branches before changing saved data', async () => {
  for (const problem of ['blank-success', 'conflicting-branches']) {
    const mutations = [];
    class BadRequest extends Error { constructor({ message }) { super(message); } }
    const service = loadModule('src/app/services/chatbot.service.ts', {
      '@surefy/exceptions/HTTP400Error': BadRequest,
      '../models/chatbot.model': { findById: async () => ({ published: false }), update: async () => mutations.push('bot') },
      '../models/chatBotEdge.model': { deleteChatBotEdge: async () => mutations.push('edges'), createEdges: async () => mutations.push('new edges') },
      '../models/chatBotNode.model': { deleteChatBotNode: async () => mutations.push('nodes'), createNodes: async () => mutations.push('new nodes') },
      '../models/chatbotTrigger.model': { findConflicts: async () => [] },
      uuid: { v4: () => 'new-id' },
      './chatbot/engine/condition.logic': logic,
    }).default;
    const data = {
      chatBotId: 'bot', phoneNumberIds: ['phone-id'],
      nodes: [
        { id: 'trigger', type: 'trigger', data: { attributes: { keywords: ['hi'] } } },
        { id: 'condition', data: { key: '@condition/condition-action', attributes: {
          conditions: [{ field: '{{http_response.success}}', comparator: 'equals', value: problem === 'blank-success' ? '' : 'true' }],
        } } },
      ],
      edges: problem === 'conflicting-branches' ? [
        { source: 'condition', target: 'failure', data: { condition: 'false' } },
        { source: 'condition', target: 'registration', data: { branch: 'false' } },
      ] : [],
    };
    await assert.rejects(service.createFlow('owner', data), problem === 'blank-success' ? /empty value/ : /multiple destinations/);
    assert.deepEqual(mutations, []);
  }
});

test('corrected GST success condition reaches registration and invalid GST reaches the failure message', async () => {
  for (const success of [true, false]) {
    const { executeNode } = runtime();
    const input = fixture({ conditions: [{ field: '{{http_response.success}}', comparator: 'equals', value: 'true' }] }, {
      api_response: { success: false, data: null },
      http_response: { success, data: { valid: success } },
      details: { role: 'fpo' },
    });
    input.bot.edges = [
      { source: 'condition', target: 'false-message', label: 'false', data: { condition: 'false', sourceHandle: 'default' } },
      { source: 'condition', target: 'true-message', label: 'true', data: { condition: 'true', sourceHandle: 'default' } },
      { source: 'condition', target: 'true-message', data: { branch: 'true', sourceHandle: 'condition-true-old-id' } },
      { source: 'condition', target: 'false-message', data: { branch: 'false', sourceHandle: 'condition-false-old-id' } },
    ];
    const response = await executeNode(input);
    assert.equal(response.text, `${success}-message`);
    assert.equal(response.variables.details.role, 'fpo');
  }
});

test('conditions preserve the selected role and never fill a missing role with FPO', async () => {
  for (const variables of [{}, { role: 'Trader', details: { role: 'fpo' } }]) {
    const { executeNode } = runtime();
    const response = await executeNode(fixture({}, { ...variables, http_response: { success: false } }));
    assert.equal(response.variables.details.role, variables.role);
  }
});
