const XLSX = require('xlsx');
const fs = require('fs');

const input = '/tmp/customs_upload.xlsx';
const out = '/tmp/customs-import/customs_reference_seed.sql';
const wb = XLSX.readFile(input);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });

function sqlString(v) {
  if (v === null || v === undefined || String(v).trim() === '') return 'NULL';
  return `'${String(v).replace(/'/g, "''").trim()}'`;
}
function sqlNum(v) {
  if (v === null || v === undefined || String(v).trim() === '') return '0';
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? String(n) : '0';
}

const values = rows
  .filter((row) => row['Товар'] && row['Країна'])
  .map((row) => `(${sqlString(row['Товар'])}, ${sqlString(row['Країна'])}, ${sqlNum(row['Ціна'])}, ${sqlNum(row['Митний збір, %'])}, ${sqlNum(row['Euro1'])}, ${sqlNum(row['Націнка Euro1'])}, true)`);

const sql = `begin;\ntruncate table public.customs_reference restart identity;\ninsert into public.customs_reference (product_name, country, threshold_price_usd, customs_fee_percent, euro1_percent, euro1_markup_usd, active) values\n${values.join(',\n')}\n;\ncommit;\n`;
fs.mkdirSync('/tmp/customs-import', { recursive: true });
fs.writeFileSync(out, sql);
console.log(`rows=${values.length}`);
console.log(out);
