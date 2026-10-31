const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const XLSX = require('xlsx');
const { fpoFormat } = require('./helpers/fpo-import-runtime');

function service(file, methods, globals) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, '../src/app/services', file), 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(ts.isClassDeclaration);
  const members = declaration.members.filter(member => methods.includes(member.name?.getText(source)));
  const code = `new class { ${members.map(member => member.getText(source)).join('\n')} }`;
  return vm.runInNewContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, { console: { log() {}, warn() {}, error() {} }, ...globals });
}

function runtime(options = {}) {
  const events = [];
  const auth = service('auth.service.ts', ['generateFpoLeadsTemplate'], { XLSX, ...fpoFormat });
  const sender = service('message.service.ts', ['sendChatBotMessage'], {
    AuthService: auth,
    PhoneNumberModel: { findByPhoneNumberId: async () => ({ id: 'local-number', user_id: 'owner', company_id: 'company' }) },
    MessageModel: { create: async data => events.push({ kind: 'save', data }) },
    uuidv4: () => 'uuid',
    MetaService: {
      sendMessage: async (phoneNumberId, payload) => {
        events.push({ kind: 'send', phoneNumberId, payload });
        if (options.sendError) throw new Error('Send failed');
        return { messages: [{ id: `${payload.type}-id` }] };
      },
      uploadMedia: async (phoneNumberId, file, type) => {
        events.push({ kind: 'upload', phoneNumberId, file, type });
        if (options.uploadError) throw new Error('Upload failed');
        return { id: 'sample-media' };
      },
    },
  });
  return { sender, events };
}

const prompt = 'Please Import excel file for onboarding fpo leads';

test('all saved FPO sample spreadsheets omit the parent FPO phone column', () => {
  for (const file of ['docs/fpo_leads_import_sample.xlsx', 'docs/samples/fpo_leads_import_sample.xlsx',
    'docs/fpo_leads_import_919372597458.xlsx']) {
    const workbook = XLSX.readFile(path.join(__dirname, '..', file));
    for (const sheet of Object.values(workbook.Sheets)) {
      const headers = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0];
      assert(headers.includes('phone_number'));
      assert.deepEqual(headers, Array.from(fpoFormat.FPO_LEAD_IMPORT_COLUMNS));
      assert(!headers.some(header => /^fpo(?:phone)?number$/i.test(String(header).replace(/[ _-]/g, ''))), file);
    }
  }
});

test('every FPO registration path in the updated flow sends welcome, upload prompt and Excel sample in order', async () => {
  const flow = require('../krishivan-unified.flow.json');
  for (const welcomeId of ['19b0b848-0763-40b8-94f4-5e1360f40434',
    '20804977-a74d-4e8c-bd50-64d3b1064ee2', 'dd6c1d42-01f1-43fd-a630-4a9e3b89ec36']) {
    const nextId = flow.edges.find(e => e.source === welcomeId).target;
    const upload = flow.nodes.find(n => n.id === nextId);
    assert.equal(upload.data.key, '@whatsapp/ask-question');
    assert.equal(upload.data.attributes.variable, 'excel_file');
    assert.equal(upload.data.attributes.resumeOnFpoImport, true);
    const { sender, events } = runtime();
    await sender.sendChatBotMessage('760184003848443', 'recipient', { messages: [
      { type: 'text', text: 'Your account has been created successfully.' },
      { type: 'text', text: upload.data.attributes.message.text.body },
    ] });
    const sent = events.filter(e => e.kind === 'send');
    assert.deepEqual(sent.map(e => e.payload.type), ['text', 'text', 'document']);
    assert.equal(sent[1].payload.text.body, prompt);
    assert.equal(sent[2].payload.document.filename, 'fpo_leads_import_sample.xlsx');
    assert(sent.every(e => e.phoneNumberId === '760184003848443'));
  }
});

test('onboarding prompt is followed by a real Excel sample sent to the same recipient and stored', async () => {
  const { sender, events } = runtime();
  await sender.sendChatBotMessage('number', 'recipient', { type: 'text', text: prompt });
  assert.deepEqual(events.map(event => event.kind), ['send', 'save', 'upload', 'send', 'save']);
  const upload = events.find(event => event.kind === 'upload');
  assert.equal(upload.phoneNumberId, 'number');
  assert.equal(upload.file.originalname, 'fpo_leads_import_sample.xlsx');
  assert.equal(upload.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const workbook = XLSX.read(upload.file.buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['FPO Leads']);
  assert.equal(rows.length, 3);
  assert(rows.every(row => row.phone_number && row.name && row.role));
  assert(rows.every(row => !Object.hasOwn(row, 'fpo_phone_number') && !Object.hasOwn(row, 'fpo_number')));
  const document = events.filter(event => event.kind === 'send')[1];
  assert.equal(document.phoneNumberId, 'number');
  assert.equal(document.payload.to, 'recipient');
  assert.equal(document.payload.type, 'document');
  assert.equal(document.payload.document.id, 'sample-media');
  assert.equal(document.payload.document.filename, upload.file.originalname);
  assert.equal(events.at(-1).data.type, 'document');
});

test('sample follows prompts with text objects, capitalization, whitespace and a trailing period', async () => {
  const { sender, events } = runtime();
  await sender.sendChatBotMessage('number', 'recipient', {
    type: 'text', text: { body: '  PLEASE IMPORT EXCEL\n FILE FOR ONBOARDING FPO LEADS.  ' },
  });
  assert.deepEqual(events.filter(event => event.kind === 'send').map(event => event.payload.type), ['text', 'document']);
});

test('batched responses send the sample directly after the prompt', async () => {
  const { sender, events } = runtime();
  await sender.sendChatBotMessage('number', 'recipient', { messages: [
    { type: 'text', text: prompt },
    { type: 'text', text: 'Next message' },
  ] });
  assert.deepEqual(events.filter(event => event.kind === 'send').map(event => event.payload.type), ['text', 'document', 'text']);
});

test('unrelated and ignored responses never upload a sample', async () => {
  const { sender, events } = runtime();
  await sender.sendChatBotMessage('number', 'recipient', { type: 'text', text: 'Welcome' });
  await sender.sendChatBotMessage('number', 'recipient', { type: 'text', text: prompt, ignoreMessage: true });
  assert.equal(events.filter(event => event.kind === 'send').length, 1);
  assert.equal(events.filter(event => event.kind === 'upload').length, 0);
});

test('a failed prompt send never uploads or sends the sample', async () => {
  const { sender, events } = runtime({ sendError: true });
  assert.equal(await sender.sendChatBotMessage('number', 'recipient', { type: 'text', text: prompt }), null);
  assert.equal(events.filter(event => event.kind === 'upload').length, 0);
});

test('an upload failure does not send a document with a missing media ID', async () => {
  const { sender, events } = runtime({ uploadError: true });
  assert.equal(await sender.sendChatBotMessage('number', 'recipient', { type: 'text', text: prompt }), null);
  assert.equal(events.filter(event => event.kind === 'send').length, 1);
});

test('Meta media uploads accept generated buffers and existing disk files', async () => {
  for (const inMemory of [true, false]) {
    const fields = [];
    const buffer = Buffer.from('sample');
    const stream = { diskStream: true };
    class FormData {
      append(...args) { fields.push(args); }
      getHeaders() { return { 'content-type': 'multipart/form-data; boundary=test' }; }
    }
    const media = service('meta.service.ts', ['uploadMedia'], {
      require: name => name === 'form-data' ? FormData : { createReadStream: file => {
        assert.equal(file, 'sample.xlsx');
        return stream;
      } },
    });
    media.accessToken = 'token';
    media.client = { post: async (url, form, options) => {
      assert.equal(url, '/number/media');
      assert.equal(options.headers.Authorization, 'Bearer token');
      return { data: { id: 'uploaded' } };
    } };
    const result = await media.uploadMedia('number', {
      originalname: 'sample.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ...(inMemory ? { buffer } : { path: 'sample.xlsx' }),
    }, 'document');
    assert.equal(result.id, 'uploaded');
    assert.equal(fields[1][1], inMemory ? buffer : stream);
    assert.equal(fields[1][2].filename, 'sample.xlsx');
  }
});
