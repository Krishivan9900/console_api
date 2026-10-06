const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function runtime(existingUser, options = {}) {
  const source = ts.createSourceFile('auth.service.ts', fs.readFileSync(path.join(__dirname, '../src/app/services/auth.service.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const serviceClass = source.statements.find(node => ts.isClassDeclaration(node));
  const methods = serviceClass.members.filter(member => ['registerUser', 'registerkrishivanUser', 'importFpoLeads'].includes(member.name?.getText(source)));
  const utils = ts.createSourceFile('utils.ts', fs.readFileSync(path.join(__dirname, '../src/utils.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const normalizer = utils.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'normalizeRole');
  const languageNormalizer = utils.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'normalizeLanguage');
  const replacer = utils.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'replaceVariables');
  const functions = [normalizer, languageNormalizer, replacer].map(node => node.getText(utils).replace(/^export /, '')).join('\n');
  const sourceText = `${functions}\nclass AuthService { ${methods.map(method => method.getText(source)).join('\n')} }\n({ service: new AuthService(), replaceVariables });`;
  const calls = { external: [], created: [], updated: [], parentLookups: [], stored: [] };
  class BadRequest extends Error { constructor({ message }) { super(message); } }
  const { service, replaceVariables } = vm.runInNewContext(ts.transpileModule(sourceText, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, {
    console: { log() {}, error() {} },
    axios: { post: async (url, data) => {
      calls.external.push(data);
      if (options.apiError) throw options.apiError;
      return { data: { user_id: 'external-user' } };
    } },
    HTTP400Error: BadRequest,
    normalizeRegistrationPhoneNumber: require('../src/phone').normalizeRegistrationPhoneNumber,
    XLSX: require('xlsx'), Buffer,
    phoneNumberModel: { findByPhoneNumberId: async () => ({ company_id: 'company', user_id: 'bot-owner' }) },
    storesSessionModel: { create: async data => { calls.stored.push(data); return { id: 'stored-session' }; } },
    userModel: {
      findByPhone: async phone => phone === options.mappedFpo?.phone ? options.mappedFpo : existingUser,
      findById: async id => { calls.parentLookups.push(id); return options.mappedFpo; },
      update: async (id, data) => { calls.updated.push({ id, data }); return data; },
    },
  });
  service.registerUserDetails = async data => { calls.created.push(data); return { ...data, id: 'new-user' }; };
  return { service, calls, replaceVariables };
}

test('selected registration roles reach the external service and saved user on creation and update', async () => {
  const roles = ['fpo', 'farmer', 'trader', 'agricultural transport service', 'micro entrepreneur', 'agricultural machinery service provider', 'agricultural input supplier', 'livestock farmer'];
  for (const existingUser of [undefined, { id: 'existing-user' }]) {
    for (const role of [...roles, ...roles.map(value => value.replaceAll(' ', '_'))]) {
      const { service, calls } = runtime(existingUser);
      const user = await service.registerUser({ company_id: 'company' }, { role, name: 'Test', phone_number: '919876543210' });
      const expected = role.replaceAll(' ', '_');
      assert.equal(calls.external[0].role, expected);
      assert.equal(calls.external[0].userType, expected);
      assert.equal(calls.external[0].mobile_number, '9876543210');
      assert.equal(user.phone, '9876543210');
      assert.equal(user.role, expected);
      assert.equal(user.role_type, expected);
      assert.match(user.role_id, new RegExp(`^${expected.slice(0, 3).toUpperCase()}\\d{6}$`));
      assert.equal(calls.created.length, existingUser ? 0 : 1);
      assert.equal(calls.updated.length, existingUser ? 1 : 0);
    }
  }
});

test('registration supports a role stored in session details and prefers the current selection', async () => {
  for (const [data, expected] of [
    [{ details: { role: 'FPO' } }, 'fpo'],
    [{ role: 'farmer', details: { role: 'fpo' } }, 'farmer'],
  ]) {
    const { service } = runtime();
    const user = await service.registerUser({ company_id: 'company' }, { ...data, name: 'Test', phone_number: '919876543210' });
    assert.equal(user.role, expected);
  }
});

test('chatbot registration payload preserves the selected role from session variables or details', async () => {
  for (const alias of ['data', 'variable']) {
    for (const [variables, expected] of [
      [{ role: 'FPO' }, 'fpo'],
      [{ details: { role: 'FPO' } }, 'fpo'],
      [{ role: 'trader', details: { role: 'fpo' } }, 'trader'],
    ]) {
      const { service, calls, replaceVariables } = runtime();
      const body = replaceVariables({ session_data: `{{${alias}}}` }, {
        ...variables, name: 'Test', phone_number: '919876543210',
      });
      const user = await service.registerUser({ company_id: 'company' }, body.session_data);
      assert.equal(user.role, expected);
      assert.equal(user.role_type, expected);
      assert.equal(calls.external[0].role, expected);
      assert.equal(calls.external[0].userType, expected);
    }
  }
});

test('registration normalizes the role labels actually offered in the role menus', async () => {
  const labels = {
    'Agri-Transport': 'agricultural_transport_service',
    'Micro-Entrepreneur': 'micro_entrepreneur',
    'Agri-Machine': 'agricultural_machinery_service_provider',
    'Agri Input Supplier': 'agricultural_input_supplier',
    Livestock: 'livestock_farmer',
    'వ్యవసాయ రవాణా సేవలు': 'agricultural_transport_service',
    'రైతు ఉత్పత్తిదారుల సంస్థ': 'fpo',
    'వ్యవసాయ యంత్రాలు': 'agricultural_machinery_service_provider',
    'వ్యవసాయ ఇన్‌పుట్లు': 'agricultural_input_supplier',
    'పశుపాలకుడు': 'livestock_farmer',
  };
  for (const [role, expected] of Object.entries(labels)) {
    const { service, calls } = runtime();
    const user = await service.registerUser({ company_id: 'company' }, { role, phone_number: '919869650435' });
    assert.equal(user.role, expected);
    assert.equal(calls.external[0].role, expected);
  }
});

test('missing role stops registration before creating an external or local user', async () => {
  for (const role of [undefined, '', '   ']) {
    const { service, calls } = runtime();
    await assert.rejects(service.registerUser({ company_id: 'company' }, { role, phone_number: '919869650435' }), /select a role/);
    assert.equal(calls.external.length, 0);
    assert.equal(calls.created.length, 0);
  }
});

test('chatbot registration carries the FPO external user_id as createdById while preserving the local parent ID', async () => {
  for (const alias of ['data', 'variable']) {
    const { service, calls, replaceVariables } = runtime();
    const body = replaceVariables({ session_data: `{{${alias}}}` }, {
      role: 'Trader', phone_number: '919869650435', user_id: 'bot-owner',
      fpo_id: 'fpo-external-user-id', parent_user_id: 'fpo-local-id',
    });
    const user = await service.registerUser({ company_id: 'company' }, body.session_data);
    assert.equal(calls.external[0].createdById, 'fpo-external-user-id');
    assert.equal(user.parent_user_id, 'fpo-local-id');
    assert.equal(user.user_id, 'external-user');
    assert.equal(calls.parentLookups.length, 0);
  }
});

test('older registration payloads resolve the creator from the mapped FPO user_id', async () => {
  for (const data of [
    { parent_user_id: 'fpo-local-id' },
    { parent_user_id: 'fpo-local-id', fpo_id: 'fpo-local-id' },
    { details: { parent_user_id: 'fpo-local-id' } },
  ]) {
    const { service, calls } = runtime(undefined, { mappedFpo: { id: 'fpo-local-id', user_id: 'fpo-external-user-id' } });
    await service.registerUser({ company_id: 'company' }, { ...data, role: 'trader', phone_number: '919869650435' });
    assert.equal(calls.external[0].createdById, 'fpo-external-user-id');
    assert.deepEqual(calls.parentLookups, ['fpo-local-id']);
  }
});

function excelFile(phone = '9869650435', role = 'Trader') {
  const XLSX = require('xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { 'Mobile Number': phone, Name: 'Parth', Role: role },
  ]), 'Leads');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

test('Excel import registers leads with the mapped FPO external creator ID and local parent ID', async () => {
  const { service, calls } = runtime(undefined, { mappedFpo: {
    id: 'fpo-local-id', user_id: 'fpo-external-user-id', phone: '919372597458',
  } });
  const result = await service.importFpoLeads(excelFile(), 'receiving-number', '919372597458');
  assert.equal(result.imported_count, 1);
  assert.equal(result.failed_count, 0);
  assert.equal(calls.external[0].createdById, 'fpo-external-user-id');
  assert.equal(calls.external[0].role, 'trader');
  assert.equal(calls.created[0].parent_user_id, 'fpo-local-id');
  assert.equal(calls.stored[0].data.fpo_id, 'fpo-external-user-id');
  assert.equal(calls.stored[0].data.parent_user_id, 'fpo-local-id');
  assert.equal(calls.parentLookups.length, 0);
});

test('mapped FPOs without an external user_id are rejected before registering users', async () => {
  const { service, calls } = runtime(undefined, { mappedFpo: { id: 'fpo-local-id', phone: '919372597458' } });
  await assert.rejects(service.registerUser({ company_id: 'company' }, {
    role: 'trader', parent_user_id: 'fpo-local-id', phone_number: '919869650435',
  }), /missing its Krishivan user_id/);
  await assert.rejects(service.importFpoLeads(excelFile(), 'receiving-number', '919372597458'), /missing its Krishivan user_id/);
  assert.equal(calls.external.length, 0);
  assert.equal(calls.created.length, 0);
  assert.equal(calls.stored.length, 0);
});

test('chatbot registration sends and stores national numbers and preserves 10-digit numbers beginning with 91', async () => {
  for (const [phone, expected] of [
    ['919869650435', '9869650435'],
    ['+91 98696 50435', '9869650435'],
    ['9869650435', '9869650435'],
    [9869650435, '9869650435'],
    ['9123456789', '9123456789'],
    ['919123456789', '9123456789'],
  ]) {
    const { service, calls } = runtime();
    const user = await service.registerUser({ company_id: 'company' }, { role: 'trader', phone_number: phone });
    assert.equal(calls.external[0].mobile_number, expected);
    assert.equal(user.phone, expected);
  }
});

test('Excel import accepts national and 91-prefixed mobile numbers for every registration role', async () => {
  const roles = ['farmer', 'trader', 'fpo', 'agricultural_transport_service', 'micro_entrepreneur', 'agricultural_machinery_service_provider', 'agricultural_input_supplier', 'livestock_farmer'];
  for (const role of roles) {
    for (const [phone, expected] of [
      ['9869650435', '9869650435'],
      ['919869650435', '9869650435'],
      ['+91 98696 50435', '9869650435'],
      ['9123456789', '9123456789'],
    ]) {
      const { service, calls } = runtime(undefined, { mappedFpo: {
        id: 'fpo-local-id', user_id: 'fpo-external-user-id', phone: '919372597458',
      } });
      const result = await service.importFpoLeads(excelFile(phone, role), 'receiving-number', '919372597458');
      assert.equal(result.imported_count, 1);
      assert.equal(result.failed_count, 0);
      assert.equal(calls.external[0].mobile_number, expected);
      assert.equal(calls.external[0].role, role);
      assert.equal(calls.external[0].createdById, 'fpo-external-user-id');
      assert.equal(calls.stored[0].data.phone_number, expected);
    }
  }
});

test('register-user HTTP boundary strips 91 for FPO and every other role even when called directly', async () => {
  const roles = ['fpo', 'farmer', 'trader', 'agricultural_transport_service', 'micro_entrepreneur', 'agricultural_machinery_service_provider', 'agricultural_input_supplier', 'livestock_farmer'];
  for (const role of roles) {
    const { service, calls } = runtime();
    const input = { role, userType: role, mobile_number: '919372597458', createdById: 'fpo-external-user-id' };
    await service.registerkrishivanUser(input);
    assert.equal(calls.external[0].mobile_number, '9372597458');
    assert.equal(calls.external[0].role, role);
    assert.equal(calls.external[0].createdById, input.createdById);
    assert.equal(input.mobile_number, '919372597458');
  }
});

test('register-user HTTP boundary still handles duplicate registration responses and propagates other failures', async () => {
  const duplicate = { response: { status: 409, data: { message: 'Mobile number already registered' } } };
  const { service } = runtime(undefined, { apiError: duplicate });
  const result = await service.registerkrishivanUser({ mobile_number: '919372597458' });
  assert.equal(result.alreadyRegistered, true);
  assert.equal(result.message, duplicate.response.data.message);
  const failure = new Error('Service unavailable');
  const failing = runtime(undefined, { apiError: failure });
  await assert.rejects(failing.service.registerkrishivanUser({ mobile_number: '919372597458' }), error => error === failure);
});
