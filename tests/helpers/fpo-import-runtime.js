const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const XLSX = require('xlsx');

function moduleFrom(file, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, {
    exports, Buffer, console: { log() {}, error() {} },
    require(name) { assert(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`); return mocks[name]; },
  });
  return exports;
}

function excelFile(count) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(Array.from({ length: count }, (_, i) => ({
    phone_number: `98765${String(i).padStart(5, '0')}`, name: `Farmer ${i}`, role: 'farmer',
  }))), 'Farmers');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function runtime(options = {}) {
  const calls = { imported: [], sent: [], sentSnapshots: [], updates: [], lookups: [], normal: [], errors: [], queued: [], rows: [] };
  const records = new Map();
  const number = '760184003848443', phone = '919372597458';
  const session = {
    id: 'session', chatbot_id: 'bot', active: true, phoneNumberId: options.sessionNumber || number,
    current_node_id: 'upload', variables: { phone_number: phone, role: 'FPO', email: 'fpo@example.test' },
  };
  const bot = { nodes: [
    { id: 'upload', data: { key: '@whatsapp/ask-question', attributes: { variable: 'excel_file', resumeOnFpoImport: true } } },
    { id: 'services', data: { key: '@whatsapp/send-button-message' } },
  ], edges: [{ source: 'upload', target: 'services' }] };
  const sessions = {
    findActiveByPhoneNumberId: async (sender, receivingNumber) => {
      calls.lookups.push([sender, receivingNumber]);
      return session.active && sender === phone && receivingNumber === session.phoneNumberId ? session : null;
    },
    update: async (_id, data) => { calls.updates.push(data); Object.assign(session, data); },
  };
  const jobs = {
    findById: async id => records.get(id),
    createFpoImport: async data => {
      if (records.has(data.id)) return { job: records.get(data.id), created: false };
      records.set(data.id, structuredClone(data)); return { job: data, created: true };
    },
    update: async (id, data) => { Object.assign(records.get(id), structuredClone(data)); },
    updateStatus: async (id, status) => { records.get(id).status = status; },
    markAsCompleted: async (id, result) => { Object.assign(records.get(id), { status: 'completed', result: structuredClone(result) }); },
    markAsFailed: async (id, error) => Object.assign(records.get(id), { status: 'failed', error_message: error.message }),
    claimFpoNotification: async (id, phase) => {
      const record = records.get(id), key = `${phase}_claimed`;
      if (record.import_options[key]) return false;
      record.import_options[key] = true; return true;
    },
  };
  const sender = { sendChatBotMessage: async (receivingNumber, recipient, response) => {
    assert.equal(receivingNumber, number); assert.equal(recipient, phone);
    calls.sent.push(response);
    const record = [...records.values()][0];
    calls.sentSnapshots.push({ stored: calls.rows.length, processed: record?.processed_rows, status: record?.status });
    if (options.sendThrows) throw new Error('Send uncertain');
    if (options.failProgressSends && response.text?.startsWith('Contact import:')) return null;
    return options.sendFailure ? null : { messages: [{ id: 'sent' }] };
  } };
  const flow = moduleFrom('src/app/services/chatbot/fpoImport.flow.ts', {
    '../../models/chatSession.model': sessions,
    './runtimeBot': { getRuntimeBot: async () => bot },
    './engine/executeNode': { executeNode: async () => {
      if (options.continuationError) throw new Error('Unable to build menu');
      return { type: 'interactive', interactive: { type: 'button', body: { text: 'Services menu' } } };
    } },
  });
  const authSource = ts.createSourceFile('auth.ts', fs.readFileSync(path.join(__dirname, '../../src/app/services/auth.service.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const importMethod = authSource.statements.find(ts.isClassDeclaration).members.find(m => m.name?.getText(authSource) === 'importFpoLeads');
  const auth = vm.runInNewContext(ts.transpileModule(`new class { ${importMethod.getText(authSource)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    XLSX, Buffer, HTTP400Error: class extends Error { constructor({ message }) { super(message); } },
    phoneNumberModel: { findByPhoneNumberId: async () => ({ user_id: 'owner', company_id: 'company' }) },
    userModel: { findByPhone: async () => ({ id: 'fpo', user_id: 'external-fpo', phone }), update: async () => {} },
    storesSessionModel: { create: async data => { calls.rows.push(data); return { id: `stored-${calls.rows.length}` }; } },
    normalizeRegistrationPhoneNumber: value => value.replace(/\D/g, '').slice(-10),
    normalizeRole: role => role.toLowerCase(), normalizeRegistrationData: data => data,
  });
  auth.registerUser = async (_number, data) => {
    if (options.rowError || options.failRows?.includes(data.phone_number)) throw new Error('Invalid row');
    return { id: data.phone_number };
  };
  const actualImport = auth.importFpoLeads.bind(auth);
  auth.importFpoLeads = async (...args) => {
    calls.imported.push(args);
    if (options.importError) throw new Error('Invalid spreadsheet');
    if (options.result) return options.result;
    return actualImport(...args);
  };
  const queue = options.queue || { add: async (...args) => { calls.queued.push(args); return {}; } };
  const service = moduleFrom('src/app/services/fpoLeadImport.service.ts', {
    xlsx: XLSX, uuid: require('uuid'), './auth.service': auth, './message.service': sender,
    '../models/phoneNumber.model': { findByPhoneNumberId: async () => ({ user_id: 'owner', company_id: 'company' }) },
    '../models/chatSession.model': sessions, '../models/importJob.model': jobs,
    '../../queues/contactImport.queue': { contactImportQueue: queue }, './chatbot/fpoImport.flow': flow,
  });
  const tasks = [], seen = new Set();
  const source = ts.createSourceFile('controller.ts', fs.readFileSync(path.join(__dirname, '../../src/app/http/controllers/message.controller.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const methods = source.statements.find(ts.isClassDeclaration).members.filter(m => ['handleWebhook', 'processWebhookPayload'].includes(m.name?.getText(source)));
  const controller = vm.runInNewContext(ts.transpileModule(`new class { ${methods.map(m => m.getText(source)).join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    console: { log() {}, error: (...args) => calls.errors.push(args) },
    MessageService: {
      ...sender, saveIncomingMessage: async () => {}, handleStatusUpdate: async () => {},
      claimInboundMessage: async id => { if (seen.has(id)) return false; seen.add(id); return true; },
      runInSenderQueue: (_sender, task) => { const promise = task(); tasks.push(promise); return promise; },
    },
    MetaService: { downloadMediaBuffer: async () => ({ buffer: excelFile(options.count || 3) }) },
    submitFpoLeadImport: service.submitFpoLeadImport,
    handleIncomingMessageChatBot: async (...args) => calls.normal.push(args),
  });
  return {
    calls, session, bot, records, service, jobs, number, phone,
    submit: (count, extra = {}) => service.submitFpoLeadImport({
      file: excelFile(count), phoneNumberId: number, uploadingFpoPhone: phone,
      messageId: 'upload-message', document: { id: 'uploaded-document', filename: 'fpo-leads.xlsx' }, ...extra,
    }),
    receive: async (message = {}) => {
      let acknowledged = false;
      await controller.handleWebhook({ body: { entry: [{ changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: number }, messages: [{
          id: 'webhook-message', from: phone, type: 'document',
          document: { id: 'uploaded-document', filename: 'fpo-leads.xlsx' }, ...message,
        }],
      } }] }] } }, { status(code) { assert.equal(code, 200); return this; }, json() { acknowledged = true; } });
      assert(acknowledged);
      await Promise.all(tasks);
    },
  };
}

module.exports = { runtime, excelFile, moduleFrom };
