const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function runtime() {
  const updates = [];
  const exports = {};
  const mocks = {
    '@surefy/console/app/models/chatSession.model': { update: async (id, data) => updates.push({ id, ...data }) },
    '@surefy/console/services/chatbot/engine/executeNode': { executeNode: async ({ session }) => session.variables },
    '@surefy/console/utils': { downloadImage: async () => { throw new Error('Unexpected download'); } },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/services/chatbot/flows/menu.flow.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, {
    exports, console: { log() {} },
    require(name) { assert(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`); return mocks[name]; },
  });
  return { menuFlow: exports.menuFlow, updates };
}

test('role replies save the actual title in both role fields, including global replies to an earlier menu', async () => {
  for (const currentNodeId of ['role-menu', 'name-question']) {
    for (const role of ['Trader', 'Farmer', 'FPO']) {
      const { menuFlow, updates } = runtime();
      const variables = await menuFlow({
        bot: {
          nodes: [
            { id: 'role-menu', data: { key: '@whatsapp/send-list-message', attributes: { variable: 'role' } } },
            { id: 'name-question', data: { key: '@whatsapp/ask-question', attributes: { variable: 'name' } } },
          ],
          edges: [{ source: 'role-menu', target: 'name-question', data: { button_id: 'selected-role' } }],
        },
        session: { id: 'session', current_node_id: currentNodeId, variables: { name: 'Mayuri', details: { role: 'fpo' } } },
        incomingId: 'selected-role', incomingText: role.toLowerCase(),
        message: { type: 'interactive', interactive: { list_reply: { id: 'selected-role', title: role } } },
      });
      assert.equal(variables.role, role);
      assert.equal(variables.details.role, role);
      assert.equal(variables.name, 'Mayuri');
      assert.equal(updates[0].variables.role, role);
    }
  }
});

test('ordinary question handling preserves interactive role titles when no global edge exists', async () => {
  const { menuFlow } = runtime();
  const variables = await menuFlow({
    bot: {
      nodes: [
        { id: 'role-menu', data: { key: '@whatsapp/send-list-message', attributes: { variable: 'role' } } },
        { id: 'next', data: { key: '@test/message' } },
      ],
      edges: [{ source: 'role-menu', target: 'next' }],
    },
    session: { id: 'session', current_node_id: 'role-menu', variables: { details: { role: 'fpo' } } },
    incomingId: 'trader', incomingText: 'trader',
    message: { type: 'interactive', interactive: { list_reply: { id: 'trader', title: 'Trader' } } },
  });
  assert.equal(variables.role, 'Trader');
  assert.equal(variables.details.role, 'Trader');
});
