import * as XLSX from 'xlsx';
import HTTP400Error from '@surefy/exceptions/HTTP400Error';

export const FPO_LEAD_IMPORT_COLUMNS = [
  'phone_number', 'name', 'email', 'role', 'native_language', 'address', 'village',
  'subdistrict', 'district', 'state', 'pincode', 'latitude', 'longitude',
] as const;

export const FPO_IMPORT_FORMAT_CODE = 'FPO_IMPORT_FORMAT';

function invalidFormat(reason: string, details: Record<string, unknown> = {}) {
  return new HTTP400Error({
    message: `Please upload the Excel file in the sample format. ${reason} Download the sample file, keep its column headings, and upload it again.`,
    details: { code: FPO_IMPORT_FORMAT_CODE, ...details },
  });
}

function normalizeHeader(value: unknown) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/** Reject the entire file before queueing or registering any contacts. */
export function parseFpoLeadImport(file: string | Buffer) {
  let workbook: XLSX.WorkBook;
  try {
    const options = { cellText: true, cellDates: true };
    workbook = Buffer.isBuffer(file) ? XLSX.read(file, { ...options, type: 'buffer' }) : XLSX.readFile(file, options);
  } catch {
    throw invalidFormat('The file could not be read as an Excel or CSV spreadsheet.');
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw invalidFormat('The file does not contain a worksheet.');

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false, blankrows: true });
  const headers = [...(grid[0] || [])];
  // Ignore formatting-only trailing cells, but never unnamed columns with data.
  while (headers.length && !normalizeHeader(headers[headers.length - 1]) &&
      grid.every(row => !String(row[headers.length - 1] ?? '').trim())) headers.pop();

  const expected = new Map(FPO_LEAD_IMPORT_COLUMNS.map(column => [normalizeHeader(column), column]));
  const normalized = headers.map(normalizeHeader);
  const missing = FPO_LEAD_IMPORT_COLUMNS.filter(column => !normalized.includes(normalizeHeader(column)));
  const unexpected = headers.filter((header, index) => !expected.has(normalized[index])).map(header => String(header || '(blank column)'));
  const duplicates = [...new Set(normalized.filter((header, index) => normalized.indexOf(header) !== index))]
    .map(header => expected.get(header) || header || '(blank column)');
  if (missing.length || unexpected.length || duplicates.length) {
    const list = (columns: string[]) => columns.slice(0, 8).map(column => column.slice(0, 48)).join(', ') +
      (columns.length > 8 ? `, and ${columns.length - 8} more` : '');
    const issues = [
      missing.length ? `Missing columns: ${missing.join(', ')}.` : '',
      unexpected.length ? `Unexpected columns: ${list(unexpected)}.` : '',
      duplicates.length ? `Duplicate columns: ${list(duplicates)}.` : '',
    ].filter(Boolean).join(' ');
    throw invalidFormat(issues, { missing_columns: missing, unexpected_columns: unexpected, duplicate_columns: duplicates });
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
  if (!rows.length) throw invalidFormat('The file does not contain any lead rows.');
  return { rows };
}
