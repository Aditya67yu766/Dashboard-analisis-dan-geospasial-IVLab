import * as XLSX from 'xlsx';
import { csvFieldAliases, requiredCsvFields } from './constants';
import {
  hasField,
  normalizeKey,
  recordFromValues,
  type CsvRecord,
  type ParsedImport
} from './importRecord';

export type SpreadsheetProgress = (processed: number, valid: number) => void;

const dateHeaders = new Set(csvFieldAliases.registration_date);
// Serial Excel 1 = 1900-01-01, tetapi karena bug tahun kabisat 1900 dipakai
// epoch 1899-12-30 agar tanggal setelah Februari 1900 tetap tepat.
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
// Batas wajar untuk membedakan serial tanggal Excel dari angka biasa.
const MIN_SERIAL = 20_000;
const MAX_SERIAL = 80_000;

function isoFromParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isoFromDate(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  return isoFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const days = Math.floor(serial);
  if (days < MIN_SERIAL || days > MAX_SERIAL) return null;
  return isoFromDate(new Date(EXCEL_EPOCH_UTC + days * DAY_MS));
}

function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v == null) return '';
  const value = cell.v;
  if (value instanceof Date) return isoFromDate(value) ?? '';
  return String(value).trim();
}

function cellDateText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v == null) return '';
  const value = cell.v;
  if (value instanceof Date) return isoFromDate(value) ?? '';
  if (typeof value === 'number') return excelSerialToIso(value) ?? '';
  const text = String(value).trim();
  if (/^\d{5,6}(?:\.\d+)?$/.test(text)) return excelSerialToIso(Number(text)) ?? text;
  return text;
}

function headerText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v == null) return '';
  return normalizeKey(String(cell.v));
}

function findHeaderRow(data: XLSX.CellObject[][]): { index: number; headers: string[] } | null {
  const limit = Math.min(data.length, 30);
  let best: { index: number; headers: string[]; score: number } | null = null;
  for (let index = 0; index < limit; index += 1) {
    const row = data[index];
    if (!row) continue;
    const headers = row.map((cell) => headerText(cell));
    const score = requiredCsvFields.filter((field) => hasField(headers, field)).length;
    if (score > (best?.score ?? 0)) best = { index, headers, score };
    if (score === requiredCsvFields.length) break;
  }
  return best && best.score >= 2 ? { index: best.index, headers: best.headers } : null;
}

export function parseWorkbook(buffer: ArrayBuffer, onProgress?: SpreadsheetProgress): ParsedImport {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(new Uint8Array(buffer), {
      type: 'array',
      dense: true,
      cellDates: false,
      cellText: false,
      cellHTML: false,
      cellFormula: false,
      cellStyles: false,
      cellNF: false,
      bookVBA: false
    });
  } catch {
    throw new Error('File Excel tidak dapat dibaca. Pastikan file tidak rusak atau terkunci kata sandi.');
  }

  const rows: CsvRecord[] = [];
  let skippedMissingProvince = 0;
  let skippedInvalidDate = 0;
  let skippedIncomplete = 0;
  let legacyFormat = false;
  let processed = 0;
  const skippedSheets: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = sheet?.['!data'];
    if (!data || !data.length) continue;

    const header = findHeaderRow(data);
    if (!header) {
      skippedSheets.push(`${sheetName} (header tidak dikenali)`);
      continue;
    }

    const missing = requiredCsvFields.filter((field) => !hasField(header.headers, field));
    if (missing.length) {
      skippedSheets.push(`${sheetName} (kolom ${missing.join(', ')} tidak ada)`);
      continue;
    }

    if (!header.headers.includes('registration_date')) legacyFormat = true;
    const dateColumns = new Set(header.headers.filter((name) => dateHeaders.has(name)));

    for (let index = header.index + 1; index < data.length; index += 1) {
      const cells = data[index];
      if (!cells || !cells.length) continue;

      const values: Record<string, string> = {};
      let hasValue = false;
      for (let column = 0; column < header.headers.length; column += 1) {
        const key = header.headers[column];
        if (!key) continue;
        const cell = cells[column];
        const text = dateColumns.has(key) ? cellDateText(cell) : cellText(cell);
        values[key] = text;
        if (text) hasValue = true;
      }
      if (!hasValue) continue;

      processed += 1;
      const outcome = recordFromValues(values, index + 1, true);
      if (outcome.status === 'row') rows.push(outcome.record);
      else if (outcome.status === 'skip-province') skippedMissingProvince += 1;
      else if (outcome.status === 'skip-date') skippedInvalidDate += 1;
      else skippedIncomplete += 1;

      if (onProgress && processed % 5000 === 0) onProgress(processed, rows.length);
    }

    // Bebaskan memori sheet setelah selesai diproses, terutama untuk file besar.
    delete workbook.Sheets[sheetName];
  }

  if (!rows.length) {
    const detail = skippedSheets.length ? ` ${skippedSheets.join('; ')}.` : '';
    throw new Error(`Tidak ada baris valid yang bisa diimpor dari file Excel.${detail}`);
  }

  onProgress?.(processed, rows.length);
  return { rows, skippedMissingProvince, skippedInvalidDate, skippedIncomplete, legacyFormat };
}
