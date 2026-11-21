# SI-BVET IV Lab

Landing page, ringkasan grafik dan peta sebaran, serta panel admin untuk data IV Lab. Aplikasi menggunakan Vite di Vercel dan Supabase untuk autentikasi serta PostgreSQL.

## Menyiapkan Supabase

1. Buat proyek di Supabase.
2. Jalankan isi [`supabase/schema.sql`](./supabase/schema.sql) melalui SQL Editor.
3. Buat satu akun admin melalui **Authentication → Users → Add user**.
4. Salin UUID akun tersebut, lalu daftarkan sebagai admin melalui SQL Editor:

   ```sql
   insert into public.iv_lab_admins (user_id)
   values ('UUID-AKUN-ADMIN');
   ```

5. Salin **Project URL** dan **anon/public key** dari Project Settings → API.
6. Untuk pengembangan lokal, salin `.env.example` menjadi `.env.local`, lalu isi nilainya. Jangan pernah memasukkan `service_role` key ke aplikasi browser.

## Menjalankan lokal dan deploy

```bash
npm install
npm run dev
```

Di Vercel, impor repository ini dan tambahkan environment variables `VITE_SUPABASE_URL` serta `VITE_SUPABASE_ANON_KEY`, lalu deploy. Vercel akan menjalankan `npm run build` secara otomatis.

Kebijakan Row Level Security membatasi perubahan data ke UUID admin yang didaftarkan. Halaman publik hanya memanggil fungsi agregasi dan tidak dapat membaca kode sampel atau data baris per baris.

## Login admin dan sesi

Login admin menggunakan email dan kata sandi Supabase. Sesi tidak disimpan ke penyimpanan browser, sehingga halaman yang dimuat ulang akan meminta login kembali. Setiap penghapusan data juga meminta kata sandi admin lagi.

Jika sebelumnya sudah menjalankan versi skema yang mewajibkan MFA, jalankan ulang versi terbaru `supabase/schema.sql` di Supabase SQL Editor agar kebijakan database kembali sesuai login kata sandi biasa.

Gunakan tombol **Keluar** setelah selesai bekerja. Sesi lokal juga berakhir saat halaman dimuat ulang atau tab ditutup.

## Format impor CSV

Kolom wajib mengikuti dashboard IV Lab saat ini:

`registration_date`, `kode_sampel`, `nama_uji`, `metode_uji`, `provinsi`

Saat impor, baris dengan kolom `provinsi` kosong akan dilewati dan jumlahnya ditampilkan setelah proses. Kolom wajib lain yang kosong tetap menyebabkan impor berhenti dengan pesan kesalahan.

Kolom `interpretasi_hasil` boleh kosong (atau tidak disertakan jika hasil belum tersedia); data akan tersimpan tanpa hasil dan tidak dihitung sebagai positif. Kolom opsional lain: `kabupaten`, `kabupaten/kota`, `kecamatan`, `no_registrasi`, `sample_analysis_number`, `hewan`, dan `jenis_layanan`. Tanggal menerima format `YYYY-MM-DD` atau `DD/MM/YYYY`. Kolom kabupaten dan kecamatan dipakai untuk mencocokkan warna peta ke wilayahnya.

Jika database Supabase sudah dibuat sebelumnya, jalankan ulang `supabase/schema.sql` agar kolom `interpretasi_hasil` menerima nilai kosong.

Setiap file CSV yang diimpor admin menambahkan baris ke tabel data yang sama. Gunakan satu file untuk satu tahun; data 2021, lalu 2022, dan seterusnya akan tampil bersama di dashboard. Daftar impor di Panel Admin mencatat nama file, tahun, dan jumlah baris; menghapus satu file menghapus hanya baris dari impor tersebut. Mengimpor file yang sama lagi akan menambahkan duplikat. Data yang sudah ada sebelum daftar impor tersedia ditampilkan sebagai **Data lama** per tahun karena nama file sumbernya tidak tercatat; menghapus entri lama menghapus data lama pada tahun itu. Panel Admin juga menyediakan **Hapus semua data**, dengan konfirmasi mengetik `HAPUS SEMUA DATA`.

## Dashboard Olah Data dan Dashboard Peta

Kedua dashboard adalah halaman React yang mengambil data agregat langsung dari fungsi Supabase `public_iv_lab_dashboard_data()`:

- **Olah Data** (`src/pages/ChartsPage.tsx`): grafik dan tabel ringkasan sampel, positif, dan seropositif per metode uji, hari, bulan, tahun, dan provinsi. Dimensi **Per Metode Uji** dan **Per Penyakit** tersedia sebagai checkbox yang bisa dicentang keduanya; kedua grafik lalu ditampilkan bertumpuk ke bawah dengan tinggi baris yang longgar agar label tidak saling menimpa. Filter tahun/provinsi/penyakit juga berupa checkbox multi-select (AI/influenza digabung menjadi “Influenza”). Tersedia tab tabel dan cakupan data, pencarian, pengurutan, serta unduh CSV/PNG. Data per penyakit diambil dari baris `target` pada RPC dashboard; angka positif pada tampilan ini sudah termasuk seropositif.
- **Peta Wilayah** (`src/pages/MapPage.tsx`): peta status wilayah per provinsi, kabupaten/kota, dan kecamatan dengan filter checkbox tahun, provinsi, kabupaten/kota, kecamatan, status, dan penyakit (bisa dipilih beberapa sekaligus). Tersedia mode presentasi, zoom/pan, sorotan batas wilayah beranimasi saat kursor melintas, label kecamatan kecil, grid koordinat di tepi peta, tabel wilayah, serta ekspor PNG, CSV, GeoJSON, cetak, dan **paket QGIS (.zip)**. Paket QGIS berisi `Peta_Sumbagsel.qgz` beserta layer GeoJSON dan atribut status; setelah diekstrak ke satu folder, project langsung menampilkan peta lengkap dengan warna status, batas, dan label sesuai level peta saat diekspor (EPSG:4326). Geometri batas wilayah (GADM 3.6 yang disederhanakan) tersimpan di `src/data/peta.json`.

Komponen filter checkbox bersama ada di `src/components/MultiSelect.tsx` dengan gaya di `src/styles/multiselect.css`.

Impor CSV dan input manual hanya tersedia di **Panel Admin**. Dashboard publik tidak menerima file CSV; data grafik dan peta dikirim melalui fungsi agregasi Supabase tanpa membuka kode sampel atau data baris per baris. Navigasi menggunakan menu di header aplikasi.

Saat sesi admin aktif, menu dashboard disembunyikan; admin perlu **Keluar** terlebih dahulu untuk melihat dashboard publik.

## Struktur utama

```
src/
  App.tsx                 routing, tema, autentikasi, dan aksi admin
  api/supabase.ts         klien Supabase
  data/peta.json          geometri dan batas wilayah
  lib/
    constants.ts          konstanta dan normalisasi tanggal
    csv.ts                parsing CSV impor
    peta.ts               pencocokan wilayah, agregasi peta, dan geometri
    mapExport.ts          unduh PNG/CSV/GeoJSON
  pages/
    HomePage.tsx          beranda dan ringkasan publik
    LoginPage.tsx         login admin
    AdminPage.tsx         impor, input manual, dan tabel data
    ChartsPage.tsx        dashboard olah data
    MapPage.tsx           dashboard peta
    ReauthModal.tsx       verifikasi ulang kata sandi untuk aksi sensitif
  styles/                 stylesheet dashboard
  styles.css              stylesheet utama
```

Jika database diperbarui, jalankan ulang `supabase/schema.sql` di Supabase SQL Editor agar fungsi `public_iv_lab_dashboard_data()` tersedia. Untuk memperbarui geometri peta, perbarui `src/data/peta.json`; `scripts/prepare_gadm.py` hanya diperlukan jika ingin membuat ulang geometri dari GeoJSON sumber.
