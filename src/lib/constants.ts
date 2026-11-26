export const requiredCsvFields = [
  'registration_date',
  'kode_sampel',
  'nama_uji',
  'metode_uji',
  'provinsi'
];

// Ekspor lama IV Lab tidak memiliki kolom bernama registration_date.
// `tgljawab` didahulukan karena kolom `blnthn` (periode laporan) dihitung
// dari tanggal tersebut, lalu disusul tanggal sampling dan pengiriman.
// `blnthn` dipakai paling akhir sebagai cadangan untuk rekap bulanan.
export const legacyRegistrationDateKeys = [
  'tgljawab',
  'tgs',
  'tglkirim',
  'tglterima',
  'tgldist',
  'blnthn'
];

// Kunci = nama kolom kanonik aplikasi, nilai = alias yang dikenal.
// Alias pertama yang berisi nilai akan dipakai.
export const csvFieldAliases: Record<string, string[]> = {
  registration_date: ['registration_date', ...legacyRegistrationDateKeys],
  kode_sampel: ['kode_sampel', 'kodesampel', 'noepi', 'no_registrasi'],
  nama_uji: ['nama_uji', 'targetpenyakit', 'target_penyakit', 'penyakit', 'namujilengkap'],
  metode_uji: ['metode_uji', 'tes', 'namujilengkap', 'lab'],
  interpretasi_hasil: ['interpretasi_hasil', 'hasil', 'hsla', 'hslb'],
  provinsi: ['provinsi', 'prop', 'province'],
  kabupaten: ['kabupaten', 'kabupaten/kota', 'kab_kota', 'kab'],
  kecamatan: ['kecamatan', 'kec'],
  no_registrasi: ['no_registrasi', 'noepi', 'no_epi'],
  sample_analysis_number: ['sample_analysis_number'],
  hewan: ['hewan', 'hwn'],
  jenis_layanan: ['jenis_layanan', 'jenislayanan']
};

export const provinces = ['Lampung', 'Sumatera Selatan', 'Bengkulu', 'Bangka Belitung'];

export const numberFormat = new Intl.NumberFormat('id-ID');

export function nullable(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

export function normalizeDate(value: unknown): string | null {
  const text = String(value ?? '').trim();
  // Nilai dari Excel kadang menyertakan jam, misalnya "2023-04-03 00:00:00".
  let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/);
  let year: number;
  let month: number;
  let day: number;
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T].*)?$/);
    if (!match) return null;
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
