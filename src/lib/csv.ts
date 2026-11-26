import Papa from 'papaparse';
import { csvFieldAliases, normalizeDate, nullable, requiredCsvFields } from './constants';

export type CsvRecord = {
  registration_date: string;
  kode_sampel: string;
  nama_uji: string;
  metode_uji: string;
  interpretasi_hasil: string | null;
  provinsi: string;
  kabupaten: string | null;
  kecamatan: string | null;
  no_registrasi: string | null;
  sample_analysis_number: string | null;
  hewan: string | null;
  jenis_layanan: string | null;
};

export type ParsedCsv = {
  rows: CsvRecord[];
  skippedMissingProvince: number;
  skippedInvalidDate: number;
  legacyFormat: boolean;
};

type CsvProgress = (processed: number, valid: number) => void;

type RowOutcome =
  | { status: 'row'; record: CsvRecord }
  | { status: 'skip-province' }
  | { status: 'skip-date' };

function normalizeKey(key: string): string {
  return key.replace(/^\uFEFF/, '').trim().toLowerCase();
}

function parseWrappedRow(text: string): string[] {
  // Ekspor lama menyimpan seluruh baris sebagai satu field berkutip. Beberapa
  // nilai memakai backslash sebelum tanda kutip, jadi disamakan dengan "".
  const normalized = text.replace(/\\"/g, '""');
  const result = Papa.parse<string[]>(normalized, { header: false, skipEmptyLines: false });
  return (result.data[0] ?? []).map((cell) => String(cell ?? '').trim());
}

function hasField(headers: string[], field: string): boolean {
  return (csvFieldAliases[field] ?? [field]).some((alias) => headers.includes(alias));
}

function pick(values: Record<string, string>, field: string): string {
  for (const alias of csvFieldAliases[field] ?? [field]) {
    const value = values[alias];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

function csvToRecord(values: Record<string, string>, rowNumber: number): RowOutcome {
  const provinsi = pick(values, 'provinsi');
  if (!provinsi) return { status: 'skip-province' };

  const missing = requiredCsvFields.filter(
    (field) => field !== 'registration_date' && field !== 'provinsi' && !pick(values, field)
  );
  if (missing.length) {
    throw new Error(`Baris ${rowNumber}: kolom wajib kosong (${missing.join(', ')}).`);
  }

  const date = normalizeDate(pick(values, 'registration_date'));
  if (!date) return { status: 'skip-date' };

  return {
    status: 'row',
    record: {
      registration_date: date,
      kode_sampel: pick(values, 'kode_sampel'),
      nama_uji: pick(values, 'nama_uji'),
      metode_uji: pick(values, 'metode_uji'),
      interpretasi_hasil: nullable(pick(values, 'interpretasi_hasil')),
      provinsi,
      kabupaten: nullable(pick(values, 'kabupaten')),
      kecamatan: nullable(pick(values, 'kecamatan')),
      no_registrasi: nullable(pick(values, 'no_registrasi')),
      sample_analysis_number: nullable(pick(values, 'sample_analysis_number')),
      hewan: nullable(pick(values, 'hewan')),
      jenis_layanan: nullable(pick(values, 'jenis_layanan'))
    }
  };
}

export function parseCsv(file: File, onProgress?: CsvProgress): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    const rows: CsvRecord[] = [];
    let skippedMissingProvince = 0;
    let skippedInvalidDate = 0;
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
          const outcome = csvToRecord(values, processed + 1);
          if (outcome.status === 'row') rows.push(outcome.record);
          else if (outcome.status === 'skip-province') skippedMissingProvince += 1;
          else skippedInvalidDate += 1;
        } catch (error) {
          failAndAbort(parser, error instanceof Error ? error : new Error(String(error)));
          return;
        }

        if (onProgress && processed % 10000 === 0) onProgress(processed, rows.length);
      },
      complete: () => {
        if (settled) return;
        settled = true;
        resolve({ rows, skippedMissingProvince, skippedInvalidDate, legacyFormat: Boolean(legacyFormat) });
      },
      error: (error) => fail(error)
    });
  });
}
