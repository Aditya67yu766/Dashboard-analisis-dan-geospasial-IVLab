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

export type ParsedImport = {
  rows: CsvRecord[];
  skippedMissingProvince: number;
  skippedInvalidDate: number;
  skippedIncomplete: number;
  legacyFormat: boolean;
};

export type RowOutcome =
  | { status: 'row'; record: CsvRecord }
  | { status: 'skip-province' }
  | { status: 'skip-date' }
  | { status: 'skip-incomplete' };

export function normalizeKey(key: string): string {
  return key.replace(/^\uFEFF/, '').trim().toLowerCase();
}

export function hasField(headers: string[], field: string): boolean {
  return (csvFieldAliases[field] ?? [field]).some((alias) => headers.includes(alias));
}

export function pick(values: Record<string, string>, field: string): string {
  for (const alias of csvFieldAliases[field] ?? [field]) {
    const value = values[alias];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

export function recordFromValues(
  values: Record<string, string>,
  rowNumber: number,
  lenient = false
): RowOutcome {
  const provinsi = pick(values, 'provinsi');
  if (!provinsi) return { status: 'skip-province' };

  const missing = requiredCsvFields.filter(
    (field) => field !== 'registration_date' && field !== 'provinsi' && !pick(values, field)
  );
  if (missing.length) {
    if (lenient) return { status: 'skip-incomplete' };
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
