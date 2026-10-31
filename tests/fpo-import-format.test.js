const assert = require('node:assert/strict');
const { test } = require('node:test');
const XLSX = require('xlsx');
const { runtime, excelFile, fpoFormat } = require('./helpers/fpo-import-runtime');
const { FPO_LEAD_IMPORT_COLUMNS: columns, parseFpoLeadImport } = fpoFormat;

function spreadsheet(headers, values = []) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...values]), 'Leads');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

const farmer = columns.map(column => ({ phone_number: '9876543210', name: 'Test Farmer', role: 'farmer' }[column] || ''));

test('sample headers are required even when optional values are blank; casing and column order are accepted', () => {
  assert.equal(parseFpoLeadImport(excelFile(100)).rows.length, 100);
  const headers = Array.from(columns, column => column.toUpperCase().replaceAll('_', ' ')).reverse();
  assert.equal(parseFpoLeadImport(spreadsheet(headers, [[...farmer].reverse()])).rows.length, 1);
  const csv = XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet([Array.from(columns), farmer]));
  assert.equal(parseFpoLeadImport(Buffer.from(csv)).rows.length, 1);
});

test('missing, unexpected, duplicate and unnamed columns reject the whole file', () => {
  const cases = [
    { headers: Array.from(columns).filter(column => column !== 'email'), values: farmer.filter((_, index) => columns[index] !== 'email'), pattern: /Missing columns: email/ },
    { headers: [...columns, 'fpo_phone_number'], values: [...farmer, '919999999999'], pattern: /Unexpected columns: fpo_phone_number/ },
    { headers: [...columns, 'Name'], values: [...farmer, 'Duplicate name'], pattern: /Duplicate columns: name/ },
    { headers: [...columns, ''], values: [...farmer, 'Unnamed value'], pattern: /Unexpected columns: \(blank column\)/ },
    { headers: ['phone_number', 'name', 'role'], values: ['9876543210', 'Test Farmer', 'farmer'], pattern: /Missing columns/ },
    { headers: [...columns].map(column => column === 'phone_number' ? 'Mobile Number' : column), values: farmer, pattern: /Missing columns: phone_number/ },
  ];
  for (const { headers, values, pattern } of cases) {
    assert.throws(() => parseFpoLeadImport(spreadsheet(headers, [values])), error => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.details.code, 'FPO_IMPORT_FORMAT');
      assert.match(error.message, /Please upload the Excel file in the sample format/);
      assert.match(error.message, pattern);
      return true;
    });
  }
});

test('empty and unreadable spreadsheets are rejected with the sample-format error', () => {
  for (const file of [spreadsheet(Array.from(columns)), Buffer.from('not a farmer spreadsheet')]) {
    assert.throws(() => parseFpoLeadImport(file), /sample format/);
  }
});

test('invalid 100-row uploads never create an import job or store a single farmer', async () => {
  const file = spreadsheet(['phone_number', 'name', 'role'], Array.from({ length: 100 }, () => ['9876543210', 'Farmer', 'farmer']));
  const rt = runtime();
  await assert.rejects(rt.submit(100, { file }), /sample format/);
  assert.equal(rt.records.size, 0);
  assert.equal(rt.calls.queued.length, 0);
  assert.equal(rt.calls.imported.length, 0);
  assert.equal(rt.calls.rows.length, 0);
});

test('WhatsApp explains the format problem and stays at the upload question without accepting any rows', async () => {
  const rt = runtime({ file: spreadsheet(['phone_number', 'name', 'role'], [['9876543210', 'Farmer', 'farmer']]) });
  await rt.receive();
  assert.equal(rt.calls.sent.length, 1);
  assert.match(rt.calls.sent[0].text, /Please upload the Excel file in the sample format.*Missing columns/);
  assert.equal(rt.records.size, 0);
  assert.equal(rt.calls.imported.length, 0);
  assert.equal(rt.calls.rows.length, 0);
  assert.equal(rt.session.current_node_id, 'upload');
  assert.equal(rt.calls.updates.length, 0);
});

test('worker revalidation rejects an incorrectly formatted queued file before registering rows', async () => {
  const rt = runtime();
  await rt.submit(100);
  const data = { ...rt.calls.queued[0][1], fileBase64: spreadsheet(['phone_number', 'name'], [['9876543210', 'Farmer']]).toString('base64') };
  await assert.rejects(rt.service.processFpoLeadImport(data), /sample format/);
  assert.equal(rt.calls.rows.length, 0);
  assert.equal(rt.calls.sent.length, 0);
});

test('very long unexpected headers cannot turn the WhatsApp format error into an oversized message', () => {
  assert.throws(() => parseFpoLeadImport(spreadsheet([...columns, 'x'.repeat(10000)], [[...farmer, 'value']])), error => {
    assert.match(error.message, /sample format/);
    assert(error.message.length < 1024);
    return true;
  });
});
