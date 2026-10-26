const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function runtime(options = {}) {
  const calls = { imported: [], sent: [], updates: [], lookups: [], normal: [], errors: [] };
  const number = '760184003848443';
  const phone = '919372597458';
  const session = {
    id: 'session', chatbot_id: 'bot', active: true, phoneNumberId: options.sessionNumber || number,
    current_node_id: 'upload', variables: { phone_number: phone, role: 'FPO', email: 'fpo@example.test' },
  };
  const bot = { nodes: [
    { id: 'upload', data: { key: '@whatsapp/ask-question', attributes: { variable: 'excel_file', resumeOnFpoImport: true } } },
    { id: 'services', data: { key: '@whatsapp/send-button-message' } },
  ], edges: [{ source: 'upload', target: 'services' }] };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/services/chatbot/fpoImport.flow.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, {
    exports,
    require(name) {
      if (name === '../../models/chatSession.model') return {
        findActiveByPhoneNumberId: async (sender, receivingNumber) => {
          calls.lookups.push([sender, receivingNumber]);
          return session.active && sender === phone && receivingNumber === session.phoneNumberId ? session : null;
        },
        update: async (_id, data) => { calls.updates.push(data); Object.assign(session, data); },
      };
      if (name === './runtimeBot') return { getRuntimeBot: async (receivingNumber, botId) => {
        assert.equal(receivingNumber, number); assert.equal(botId, 'bot'); return bot;
      } };
      if (name === './engine/executeNode') return { executeNode: async ({ currentNode }) => {
        assert.equal(currentNode.id, 'services');
        if (options.continuationError) throw new Error('Unable to build menu');
        return { type: 'interactive', interactive: { type: 'button', body: { text: 'Services menu' } } };
      } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const source = ts.createSourceFile('message.controller.ts', fs.readFileSync(path.join(__dirname, '../src/app/http/controllers/message.controller.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(ts.isClassDeclaration);
  const method = declaration.members.find(m => m.name?.getText(source) === 'handleWebhook');
  const controller = vm.runInNewContext(ts.transpileModule(`new class { ${method.getText(source)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    console: { log() {}, error: (...args) => calls.errors.push(args) },
    tryCatchAsync: fn => fn,
    MessageService: {
      saveIncomingMessage: async () => {},
      sendChatBotMessage: async (receivingNumber, recipient, response) => {
        assert.equal(receivingNumber, number); assert.equal(recipient, phone);
        calls.sent.push(response);
      },
    },
    MetaService: { downloadMediaBuffer: async mediaId => {
      assert.equal(mediaId, 'uploaded-document'); return { buffer: Buffer.from('spreadsheet') };
    } },
    AuthService: { importFpoLeads: async (...args) => {
      calls.imported.push(args);
      if (options.importError) throw new Error('Invalid spreadsheet');
      return options.result || { success: true, imported_count: 3, failed_count: 0, role_counts: { farmer: 3 } };
    } },
    resumeAfterFpoLeadImport: exports.resumeAfterFpoLeadImport,
    handleIncomingMessageChatBot: async (...args) => calls.normal.push(args),
  });
  return {
    calls, session, bot,
    receive: async () => {
      const response = { status(code) { assert.equal(code, 200); return this; }, json(data) { return data; } };
      return controller.handleWebhook({ body: { entry: [{ changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: number }, contacts: [], messages: [{
          id: 'webhook-message', from: phone, type: 'document', document: {
            id: 'uploaded-document', filename: 'fpo-leads.xlsx',
            mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        }],
      } }] }] } }, response);
    },
  };
}

test('spreadsheet webhook imports once, sends the summary, then continues the waiting flow on the same number', async () => {
  const rt = runtime();
  await rt.receive();
  assert.equal(rt.calls.imported.length, 1);
  assert.equal(rt.calls.imported[0][1], '760184003848443');
  assert.equal(rt.calls.imported[0][2], '919372597458');
  assert.equal(rt.calls.normal.length, 0);
  assert.equal(rt.calls.sent.length, 2);
  assert.equal(rt.calls.sent[0].text, '3 Farmer');
  assert.equal(rt.calls.sent[1].interactive.body.text, 'Services menu');
  assert.equal(rt.session.current_node_id, 'services');
  assert.equal(rt.session.variables.excel_file.filename, 'fpo-leads.xlsx');
  assert.equal(rt.session.variables.email, 'fpo@example.test');
  assert.equal(rt.calls.updates.length, 1);
});

test('failed or partial spreadsheet imports stay at the upload prompt without sending a services menu', async () => {
  for (const options of [
    { importError: true },
    { result: { success: false, imported_count: 2, failed_count: 1, role_counts: { farmer: 2 } } },
    { result: { success: false, imported_count: 0, failed_count: 3, role_counts: {} } },
  ]) {
    const rt = runtime(options);
    await rt.receive();
    assert.equal(rt.calls.sent.length, 1);
    assert.match(rt.calls.sent[0].text, /try again|upload it again/);
    assert.equal(rt.session.current_node_id, 'upload');
    assert.equal(rt.calls.updates.length, 0);
  }
});

test('a spreadsheet on the new number never advances a session belonging to another receiving number', async () => {
  const rt = runtime({ sessionNumber: 'old-number' });
  await rt.receive();
  assert.equal(rt.calls.lookups[0][1], '760184003848443');
  assert.equal(rt.session.current_node_id, 'upload');
  assert.equal(rt.calls.updates.length, 0);
  assert.equal(rt.calls.sent.length, 1);
});

test('ambiguous upload destinations never advance or choose an arbitrary service', async () => {
  const rt = runtime();
  rt.bot.edges.push({ source: 'upload', target: 'other-menu' });
  await rt.receive();
  assert.equal(rt.calls.updates.length, 0);
  assert.equal(rt.session.current_node_id, 'upload');
});

test('a continuation error does not tell the user that a completed import failed', async () => {
  const rt = runtime({ continuationError: true });
  await rt.receive();
  assert.equal(rt.calls.sent.length, 1);
  assert.equal(rt.calls.sent[0].text, '3 Farmer');
  assert.match(rt.calls.errors[0][0], /imported but chatbot continuation failed/);
});
