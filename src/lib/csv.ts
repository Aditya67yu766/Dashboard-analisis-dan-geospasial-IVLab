import Papa from 'papaparse';
import { requiredCsvFields } from './constants';
import {
  hasField,
  normalizeKey,
  recordFromValues,
  type CsvRecord,
  type ParsedImport
} from './importRecord';

export type { CsvRecord, ParsedImport } from './importRecord';

type CsvProgress = (processed: number, valid: number) => void;

function parseWrappedRow(text: string): string[] {
  // Ekspor lama menyimpan seluruh baris sebagai satu field berkutip. Beberapa
  // nilai memakai backslash sebelum tanda kutip, jadi disamakan dengan "".
  const normalized = text.replace(/\\"/g, '""');
  const result = Papa.parse<string[]>(normalized, { header: false, skipEmptyLines: false });
  return (result.data[0] ?? []).map((cell) => String(cell ?? '').trim());
}

export function parseCsv(file: File, onProgress?: CsvProgress): Promise<ParsedImport> {
  return new Promise((resolve, reject) => {
    const rows: CsvRecord[] = [];
    let skippedMissingProvince = 0;
    let skippedInvalidDate = 0;
    let skippedIncomplete = 0;
    let processed = 0;
    let legacyFormat: boolean | null = null;
    let headers: string[] = [];
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const failAndAbort = (parser: Papa.Parser, error: Error) => {
      settled = true;
      parser.abort();
      reject(error);
    };

    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
      step: (result, parser) => {
        if (settled) return;

        if (legacyFormat === null) {
          const rawFields = result.meta.fields ?? [];
          const outerFields = rawFields.map(normalizeKey);
          const wrapped = rawFields.length === 1 ? parseWrappedRow(rawFields[0]).map(normalizeKey) : [];
          legacyFormat = wrapped.length > 1 && requiredCsvFields.some((field) => hasField(wrapped, field));
          headers = legacyFormat ? wrapped : outerFields;

          const missing = requiredCsvFields.filter((field) => !hasField(headers, field));
          if (missing.length) {
            failAndAbort(parser, new Error(`Kolom wajib tidak ditemukan: ${missing.join(', ')}.`));
            return;
          }
        }

        processed += 1;
        const raw = result.data;
        let values: Record<string, string>;

        if (legacyFormat) {
          const key = Object.keys(raw)[0];
          const cells = parseWrappedRow(String(raw[key] ?? ''));
          values = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
        } else {
          values = Object.fromEntries(
            Object.entries(raw).map(([key, value]) => [normalizeKey(key), String(value ?? '').trim()])
          );
        }

        try {
          const outcome = recordFromValues(values, processed + 1);
          if (outcome.status === 'row') rows.push(outcome.record);
          else if (outcome.status === 'skip-province') skippedMissingProvince += 1;
          else if (outcome.status === 'skip-date') skippedInvalidDate += 1;
          else skippedIncomplete += 1;
        } catch (error) {
          failAndAbort(parser, error instanceof Error ? error : new Error(String(error)));
          return;
        }

        if (onProgress && processed % 10000 === 0) onProgress(processed, rows.length);
      },
      complete: () => {
        if (settled) return;
        settled = true;
        resolve({
          rows,
          skippedMissingProvince,
          skippedInvalidDate,
          skippedIncomplete,
          legacyFormat: Boolean(legacyFormat)
        });
      },
      error: (error) => fail(error)
    });
  });
}
