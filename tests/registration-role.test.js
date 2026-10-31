const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const fpoFormat = require('./helpers/fpo-import-runtime').fpoFormat;

function runtime(existingUser, options = {}) {
  const source = ts.createSourceFile('auth.service.ts', fs.readFileSync(path.join(__dirname, '../src/app/services/auth.service.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const serviceClass = source.statements.find(node => ts.isClassDeclaration(node));
  const methods = serviceClass.members.filter(member => ['registerUser', 'registerkrishivanUser', 'importFpoLeads', 'storedChatSession', 'generateFpoLeadsTemplate'].includes(member.name?.getText(source)));
  const utils = ts.createSourceFile('utils.ts', fs.readFileSync(path.join(__dirname, '../src/utils.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const normalizer = utils.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'normalizeRole');
  const languageNormalizer = utils.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'normalizeLanguage');
  const registrationNormalizer = utils.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'normalizeRegistrationData');
  const locationReader = utils.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'getRegistrationLocation');
  const emailReader = utils.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'getRegistrationEmail');
  const replacer = utils.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'replaceVariables');
  const functions = [normalizer, languageNormalizer, locationReader, emailReader, registrationNormalizer, replacer].map(node => node.getText(utils).replace(/^export /, '')).join('\n');
  const sourceText = `${functions}\nclass AuthService { ${methods.map(method => method.getText(source)).join('\n')} }\n({ service: new AuthService(), replaceVariables });`;
  const calls = { external: [], lookups: [], created: [], updated: [], parentLookups: [], stored: [], contactUpdates: [] };
  class BadRequest extends Error { constructor({ message }) { super(message); } }
  const { service, replaceVariables } = vm.runInNewContext(ts.transpileModule(sourceText, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, {
    console: { log() {}, error() {} },
    axios: { post: async (url, data) => {
      if (url.endsWith('/check-user')) {
        calls.lookups.push(data);
        if (options.lookupError) throw options.lookupError;
        return { data: options.lookupResponse ?? { success: true, data: { user_id: 'existing-external-user' } } };
      }
      calls.external.push(data);
      if (options.apiError) throw options.apiError;
      return { data: options.apiResponse ?? { user_id: 'external-user' } };
    } },
    HTTP400Error: BadRequest,
    normalizeRegistrationPhoneNumber: require('../src/phone').normalizeRegistrationPhoneNumber,
    XLSX: require('xlsx'), Buffer, ...fpoFormat,
    phoneNumberModel: { findByPhoneNumberId: async () => ({ company_id: 'company', user_id: 'bot-owner' }) },
    chatSessionModel: { findByPhoneNumber: async () => ({ id: 'chat-session', phoneNumberId: '760184003848443' }) },
    storesSessionModel: { create: async data => { calls.stored.push(data); return { id: 'stored-session' }; } },
    contactModel: {
      findByUserPhoneNumber: async () => options.contact,
      update: async (id, data) => calls.contactUpdates.push({ id, data }),
    },
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

test('Hindi and Telugu menu selections store English role and language codes in the registration record and user', async () => {
  const flow = require('../krishivan-unified.flow.json');
  const expectedRoles = ['farmer', 'trader', 'agricultural_transport_service', 'micro_entrepreneur', 'fpo',
    'agricultural_machinery_service_provider', 'agricultural_input_supplier', 'livestock_farmer'];
  const menus = flow.nodes.filter(n => n.data.attributes?.variable === 'role');
  for (const [index, language, selectedLanguage] of [[1, 'hindi', 'हिंदी'], [2, 'telugu', 'తెలుగు']]) {
    const labels = menus[index].data.attributes.message.interactive.action.sections.flatMap(section => section.rows.map(row => row.title));
    for (let roleIndex = 0; roleIndex < labels.length; roleIndex++) {
      const { service, calls, replaceVariables } = runtime();
      const input = { role: labels[roleIndex], native_language: selectedLanguage, name: 'Test Customer',
        phone_number: '919876543210', details: { role: labels[roleIndex] } };
      const body = replaceVariables({ session_data: '{{data}}' }, input);
      assert.equal(body.session_data.role, expectedRoles[roleIndex]);
      // Direct requests must normalize before the raw registration record is stored as well.
      await service.storedChatSession(input.phone_number, input);
      assert.equal(calls.stored[0].data.role, expectedRoles[roleIndex]);
      assert.equal(calls.stored[0].data.details.role, expectedRoles[roleIndex]);
      assert.equal(calls.stored[0].data.native_language, language);
      assert.equal(calls.created[0].role, expectedRoles[roleIndex]);
      assert.equal(calls.created[0].native_language, language);
      assert.equal(calls.external[0].role, expectedRoles[roleIndex]);
      assert.equal(calls.external[0].primary_language, language);
      assert.equal(input.role, labels[roleIndex]);
      assert.equal(input.details.role, labels[roleIndex]);
    }
  }
});

test('legacy Telugu labels and language codes normalize consistently without translating names', async () => {
  for (const [selected, expected] of [['తెలుగులో', 'telugu'], ['te', 'telugu'], ['hi', 'hindi'], ['हिन्दी', 'hindi'], ['en', 'english']]) {
    const { service, calls } = runtime();
    const name = expected === 'hindi' ? 'राम कुमार' : 'రమేష్';
    const user = await service.registerUser({ company_id: 'company' }, {
      role: 'FPO', name, phone_number: '919876543210', details: { native_language: selected },
    });
    assert.equal(user.native_language, expected);
    assert.equal(calls.external[0].primary_language, expected);
    assert.equal(user.name, name);
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

function excelFile(phone = '9869650435', role = 'Trader', fields = {}) {
  const XLSX = require('xlsx');
  const workbook = XLSX.utils.book_new();
  const row = { ...Object.fromEntries(fpoFormat.FPO_LEAD_IMPORT_COLUMNS.map(column => [column, ''])),
    phone_number: phone, name: 'Parth', role };
  for (const [header, value] of Object.entries(fields)) {
    const normalize = text => text.toLowerCase().replace(/[\s_-]+/g, '');
    const canonical = fpoFormat.FPO_LEAD_IMPORT_COLUMNS.find(column => normalize(column) === normalize(header));
    row[canonical || header] = value;
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([row]), 'Leads');
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
  assert.equal(calls.stored[0].data.fpo_phone_number, '919372597458');
  assert.equal(calls.parentLookups.length, 0);
});

test('unexpected FPO columns are rejected before an older spreadsheet can override the uploader parent', async () => {
  const { service, calls } = runtime(undefined, { mappedFpo: {
    id: 'actual-fpo-local-id', user_id: 'actual-fpo-external-id', phone: '919372597458',
  } });
  await assert.rejects(service.importFpoLeads(excelFile('9869650435', 'Farmer', {
    fpo_phone_number: '919999999999', fpo_number: '918888888888', fpo_id: 'wrong-fpo-id',
  }), 'receiving-number', '919372597458'), /sample format.*Unexpected columns/);
  assert.equal(calls.external.length, 0);
  assert.equal(calls.stored.length, 0);
});

test('Excel location values reach the registration API and both PostgreSQL records without a geocoding request', async () => {
  for (const existingUser of [undefined, { id: 'existing-user' }]) {
    const { service, calls } = runtime(existingUser, { mappedFpo: {
      id: 'fpo-local-id', user_id: 'fpo-external-user-id', phone: '919372597458',
    } });
    const result = await service.importFpoLeads(excelFile('9869650435', 'Farmer', {
      State: 'Madhya Pradesh', District: 'Indore', 'Sub District': 'Rau', Village: 'Example Village',
      Pincode: 453331, Address: '12 Market Road', Latitude: 22.68, Longitude: 75.87,
    }), 'receiving-number', '919372597458');
    assert.equal(result.imported_count, 1);
    assert.equal(result.failed_count, 0);
    assert.equal(calls.external.length, 1);
    const api = calls.external[0];
    const local = existingUser ? calls.updated.find(call => call.data.role).data : calls.created[0];
    const stored = calls.stored[0].data;
    for (const [key, value] of Object.entries({
      state: 'Madhya Pradesh', district: 'Indore', village: 'Example Village', pincode: '453331', full_address: '12 Market Road',
    })) {
      assert.equal(api[key], value);
      assert.equal(api.kyc_data.address[key], value);
      assert.equal(local.location[key], value);
      assert.equal(stored.location[key], value);
    }
    assert.equal(api.sub_distric, 'Rau');
    assert.equal(api.kyc_data.address.sub_distric, 'Rau');
    assert.equal(local.location.subdistrict, 'Rau');
    assert.equal(stored.location.subdistrict, 'Rau');
    assert.equal(local.state, 'Madhya Pradesh');
    assert.equal(api.coordinates.coordinates[0], 75.87);
    assert.equal(api.coordinates.coordinates[1], 22.68);
  }
});

test('the actual generated lowercase Excel template imports all rows and preserves its address columns', async () => {
  const { service, calls } = runtime(undefined, { mappedFpo: {
    id: 'fpo-local-id', user_id: 'fpo-external-user-id', phone: '919372597458',
  } });
  const sample = service.generateFpoLeadsTemplate();
  const result = await service.importFpoLeads(sample, 'receiving-number', '919372597458');
  assert.equal(result.imported_count, 3);
  assert.equal(result.failed_count, 0);
  assert.equal(calls.external.length, 3);
  for (const [index, expected] of ['Indore', 'Rau', 'Dewas'].entries()) {
    assert.equal(calls.external[index].sub_distric, expected);
    assert.equal(calls.stored[index].data.location.subdistrict, expected);
    assert(calls.created[index].location.state);
    assert(calls.created[index].location.district);
    assert(calls.created[index].location.village);
    assert(calls.created[index].location.pincode);
  }
  assert.equal(calls.created[0].email, 'ramesh@example.com');
  assert.equal(calls.created[0].native_language, 'hindi');
});

test('registration preserves supplied address fields through payload substitution, storage and the API', async () => {
  const { service, calls, replaceVariables } = runtime();
  const location = { state: 'Telangana', district: 'Warangal', sub_district: 'Example Mandal',
    village: 'Example Village', pincode: '506330', latitude: 0, longitude: 0 };
  const input = { name: 'Test', role: 'Farmer', phone_number: '919876543210', location };
  const body = replaceVariables({ session_data: '{{data}}' }, input);
  assert.equal(body.session_data.location.subdistrict, 'Example Mandal');
  assert.equal(body.session_data.location.village, 'Example Village');
  assert.equal(body.session_data.location.pincode, '506330');
  await service.storedChatSession(input.phone_number, body.session_data);
  assert.equal(calls.stored[0].data.location.subdistrict, 'Example Mandal');
  assert.equal(calls.created[0].location.village, 'Example Village');
  assert.equal(calls.external[0].sub_distric, 'Example Mandal');
  assert.equal(calls.external[0].coordinates.coordinates[0], 0);
  assert.equal(calls.external[0].coordinates.coordinates[1], 0);
});

test('FPO GST address reaches the API and normalized PostgreSQL location without guessing missing village or subdistrict', async () => {
  for (const includeOptionalFields of [false, true]) {
    const { service, calls, replaceVariables } = runtime();
    const company = {
      legal_name: 'Example FPO', state: '36 - Telangana TS', state_info: { name: 'Telangana' },
      pradr: {
        addr: 'Example GST address', state_in_address: 'Telangana', district: 'Medchal Malkajgiri',
        pincode: '500094', loc: 'Secunderabad', latitude: '17.48918', longitude: '78.539475',
        ...(includeOptionalFields ? { sub_district: 'Provided Mandal', village: 'Provided Village' } : {}),
      },
    };
    const body = replaceVariables({ session_data: '{{data}}' }, {
      role: 'FPO', phone_number: '919876543210', gstin: '36AAICK0914G1ZQ', details: { company_details: company },
    });
    await service.storedChatSession(body.session_data.phone_number, body.session_data);
    const api = calls.external[0];
    const stored = calls.stored[0].data.location;
    const local = calls.created[0].location;
    for (const [field, expected] of Object.entries({
      state: 'Telangana', district: 'Medchal Malkajgiri', pincode: '500094', full_address: 'Example GST address',
    })) {
      assert.equal(api[field], expected);
      assert.equal(api.kyc_data.address[field], expected);
      assert.equal(stored[field], expected);
      assert.equal(local[field], expected);
    }
    assert.equal(api.sub_distric, includeOptionalFields ? 'Provided Mandal' : null);
    assert.equal(api.village, includeOptionalFields ? 'Provided Village' : null);
    assert.equal(stored.subdistrict, includeOptionalFields ? 'Provided Mandal' : null);
    assert.equal(local.village, includeOptionalFields ? 'Provided Village' : null);
  }
});

test('GST email is stored by Render in the registration record and user without asking for it', async () => {
  for (const shape of [
    { details: { email: 'gst-contact@example.test' } },
    { details: { company_details: { email_address: ' gst-contact@example.test ' } } },
    { company_details: { email_id: 'gst-contact@example.test' } },
  ]) {
    const { service, calls } = runtime();
    await service.storedChatSession('919876543210', {
      role: 'FPO', name: 'Example FPO', phone_number: '919876543210', ...shape,
    });
    assert.equal(calls.stored[0].data.email, 'gst-contact@example.test');
    assert.equal(calls.created[0].email, 'gst-contact@example.test');
  }
});

test('an explicitly supplied email takes priority over the GST company email', async () => {
  const { service, calls } = runtime();
  await service.storedChatSession('919876543210', {
    role: 'FPO', phone_number: '919876543210', email: 'selected@example.test',
    details: { email: 'company@example.test' },
  });
  assert.equal(calls.stored[0].data.email, 'selected@example.test');
  assert.equal(calls.created[0].email, 'selected@example.test');
});

test('missing, blank or masked GST emails remain optional instead of becoming a stored contact email', async () => {
  for (const email of [undefined, null, '', '   ', 'N/A', 'pa***@example.test']) {
    const { service, calls, replaceVariables } = runtime();
    const body = replaceVariables({ session_data: '{{data}}' }, {
      role: 'FPO', phone_number: '919876543210', details: { company_details: { email } },
    });
    assert.equal(body.session_data.email, undefined);
    await service.storedChatSession(body.session_data.phone_number, body.session_data);
    assert.equal(calls.stored[0].data.email, undefined);
    assert.equal(calls.created[0].email, null);
  }
});

test('coordinates alone never create or guess district, subdistrict, village or pincode', async () => {
  const { service, calls } = runtime();
  const user = await service.registerUser({ company_id: 'company' }, {
    role: 'farmer', phone_number: '919876543210', location: { latitude: 17.48, longitude: 78.53 },
  });
  for (const field of ['state', 'district', 'village', 'pincode']) {
    assert.equal(calls.external[0][field], null);
    assert.equal(user.location[field], null);
  }
  assert.equal(calls.external[0].sub_distric, null);
  assert.equal(user.location.subdistrict, null);
  assert.equal(calls.external.length, 1);
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

test('AWS registration request keeps the flat address schema and GeoJSON coordinate order from the supplied example', async () => {
  for (const nested of [false, true]) {
    const { service, calls } = runtime();
    const address = {
      full_address: 'GWVM+V2 Vadapathy, Tamil Nadu, India', state: 'Tamil Nadu', district: 'Cuddalore',
      village: 'cuddalore', pincode: '606108',
    };
    const input = {
      role: 'trader', mobile_number: '2222222222',
      ...(nested ? { location: { ...address, subdistrict: 'Vadapathy', latitude: 11.54462829, longitude: 78.93256254 } }
        : { ...address, sub_distric: 'Vadapathy', coordinates: { type: 'Point', coordinates: [78.93256254, 11.54462829] } }),
    };
    await service.registerkrishivanUser(input);
    const payload = calls.external[0];
    for (const [field, value] of Object.entries(address)) assert.equal(payload[field], value);
    assert.equal(payload.sub_distric, 'Vadapathy');
    assert.equal(payload.coordinates.type, 'Point');
    assert.equal(payload.coordinates.coordinates[0], 78.93256254);
    assert.equal(payload.coordinates.coordinates[1], 11.54462829);
    assert.equal(input.location?.sub_distric, undefined);
  }
});

test('register-user HTTP boundary still handles duplicate registration responses and propagates other failures', async () => {
  const duplicate = { response: { status: 409, data: { message: 'Mobile number already registered' } } };
  const { service } = runtime(undefined, { apiError: duplicate });
  const result = await service.registerkrishivanUser({ mobile_number: '919372597458' });
  assert.equal(result.alreadyRegistered, true);
  assert.equal(result.data.user_id, 'existing-external-user');
  assert.equal(result.message, duplicate.response.data.message);
  const failure = new Error('Service unavailable');
  const failing = runtime(undefined, { apiError: failure });
  await assert.rejects(failing.service.registerkrishivanUser({ mobile_number: '919372597458' }), error => error === failure);
});

test('duplicate registrations link new and existing console users to the existing Krishivan ID', async () => {
  for (const existingUser of [undefined, { id: 'ramesh', user_id: 'previous-link' }]) {
    const { service, calls } = runtime(existingUser, {
      apiError: { response: { status: 409, data: { message: 'Mobile number already registered' } } },
      lookupResponse: { success: true, data: { user_id: 'ramesh-external-id', mobile_number: '9876543210' } },
      contact: { id: 'ramesh-contact' },
    });
    const user = await service.registerUser({ company_id: 'company' }, { role: 'farmer', name: 'Ramesh Patil', phone_number: '919876543210' });
    assert.equal(user.user_id, 'ramesh-external-id');
    assert.equal(calls.lookups[0].mobile_number, '9876543210');
    assert.equal(calls.created.length, existingUser ? 0 : 1);
    assert.equal(calls.updated.length, existingUser ? 1 : 0);
    if (existingUser) assert.equal(calls.contactUpdates[0].data.reference_id, 'ramesh-external-id');
  }
});

test('failed external ID recovery never writes or clears a console user link', async () => {
  const duplicate = { response: { status: 409, data: { message: 'Mobile number already registered' } } };
  for (const options of [
    { apiResponse: { success: true, data: {} } },
    { apiError: duplicate, lookupResponse: { success: false, data: null } },
    { apiError: duplicate, lookupError: new Error('Lookup unavailable') },
  ]) {
    const { service, calls } = runtime({ id: 'existing', user_id: 'keep-this-link' }, options);
    await assert.rejects(service.registerUser({ company_id: 'company' }, { role: 'farmer', phone_number: '9876543210' }));
    assert.equal(calls.created.length, 0);
    assert.equal(calls.updated.length, 0);
  }
});
