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

## Dua tautan akses: publik dan admin

Aplikasi tetap satu build, tetapi halamannya dipetakan ke URL sehingga dapat dibuka lewat dua tautan:

| Tautan | Lokal | Vercel | Isi |
| --- | --- | --- | --- |
| **Link 1 — publik** | `http://localhost:5173/` | `https://<project>.vercel.app/` | Beranda user, Ringkasan Data, Peta Wilayah |
| **Link 2 — admin** | `http://localhost:5173/admin` | `https://<project>.vercel.app/admin` | Login, beranda admin, dan panel pengelolaan data |

Rute lengkapnya:

- `/` — beranda publik
- `/ringkasan-data` — dashboard olah data
- `/peta-wilayah` — dashboard peta
- `/admin` — login admin (atau beranda admin bila sesi masih aktif)
- `/admin/panel` — panel impor, input manual, dan kelola data

Tautan publik tidak menampilkan tombol **Login admin** maupun tombol admin lainnya. Tautan admin `/admin` langsung membuka form login; setelah berhasil login, admin diarahkan ke **beranda admin**, lalu dari situ membuka menu **Pengelolaan data** (`/admin/panel`).

File [`vercel.json`](./vercel.json) meneruskan rute-rute tersebut ke `index.html`, jadi membuka atau me-refresh URL `/admin` langsung tetap berhasil di Vercel (Vite dev server melakukan hal yang sama saat lokal). Jika ingin memakai dua domain, misalnya `nama.vercel.app` dan `admin.nama.vercel.app`, arahkan keduanya ke deployment yang sama lalu bedakan berdasarkan hostname di `src/lib/routing.ts`.

Pemisahan URL hanya memisahkan tampilan dan navigasi, bukan batas keamanan. Keamanan data tetap bergantung pada Supabase Authentication dan kebijakan RLS: hanya UUID yang terdaftar di `iv_lab_admins` yang dapat menulis data, dan fungsi agregasi publik tidak membuka data baris per baris.

Kebijakan Row Level Security membatasi perubahan data ke UUID admin yang didaftarkan. Halaman publik hanya memanggil fungsi agregasi dan tidak dapat membaca kode sampel atau data baris per baris.

## Login admin dan sesi

Login admin menggunakan email dan kata sandi Supabase. Sesi tidak disimpan ke penyimpanan browser, sehingga halaman yang dimuat ulang akan meminta login kembali. Setiap penghapusan data juga meminta kata sandi admin lagi.

Jika sebelumnya sudah menjalankan versi skema yang mewajibkan MFA, jalankan ulang versi terbaru `supabase/schema.sql` di Supabase SQL Editor agar kebijakan database kembali sesuai login kata sandi biasa.

Gunakan tombol **Keluar** setelah selesai bekerja. Sesi lokal juga berakhir saat halaman dimuat ulang atau tab ditutup.

## Format impor CSV / Excel

Panel Admin menerima file `.csv`, `.xlsx`, dan `.xls` tanpa perlu mengubah file sumber:

1. **Format IV Lab saat ini** — kolom wajib `registration_date`, `kode_sampel`, `nama_uji`, `metode_uji`, `provinsi`.
2. **Ekspor lama IV Lab** — misalnya `exportvv (2).csv`, yang setiap barisnya dibungkus satu tanda kutip dan memakai nama kolom seperti `prop`, `kab`, `kec`, `kodesampel`, `lab`, `tes`, `targetpenyakit`, dan `hasil`. Parser mendeteksi format ini otomatis, termasuk escape `\"` di dalam nilai.
3. **Excel ekspor IV Lab** — misalnya `IVLAB_April-31 Desember 2023.xlsx` (sheet tunggal dengan 78 kolom, termasuk `registration_date`, `kode_sampel`, `nama_uji`, `metode_uji`, `provinsi`) dan `SMILE_jan-maret2023.xlsx` (32 kolom ala ekspor lama). Keduanya dibaca apa adanya.

Untuk Excel, tanggal yang disimpan sebagai serial Excel (misalnya `45019` untuk 2023-04-03) dikonversi otomatis ke `YYYY-MM-DD`. Parsing berjalan di Web Worker agar tampilan tetap responsif; file besar seperti `IVLAB_April-31 Desember 2023.xlsx` dapat memakan waktu beberapa saat. Sheet tanpa kolom wajib dilewati, dan sheet dengan header di baris bukan pertama tetap dikenali.

Pemetaan kolom ekspor lama ke field aplikasi:

| Field aplikasi | Kolom yang dikenal (prioritas kiri ke kanan) |
| --- | --- |
| `registration_date` | `registration_date`, `tgljawab`, `tgs`, `tglkirim`, `tglterima`, `tgldist`, `blnthn` |
| `kode_sampel` | `kode_sampel`, `kodesampel` |
| `nama_uji` (penyakit) | `nama_uji`, `targetpenyakit`, `target_penyakit`, `penyakit`, `namujilengkap` |
| `metode_uji` | `metode_uji`, `tes`, `namujilengkap`, `lab` |
| `interpretasi_hasil` | `interpretasi_hasil`, `hasil`, `hslA`, `hslB` |
| `provinsi` | `provinsi`, `prop`, `province` |
| `kabupaten` | `kabupaten`, `kabupaten/kota`, `kab_kota`, `kab` |
| `kecamatan` | `kecamatan`, `kec` |
| `no_registrasi` | `no_registrasi`, `noepi`, `no_epi` |
| `hewan` | `hewan`, `hwn` |
| `jenis_layanan` | `jenis_layanan`, `jenislayanan` |

`sample_analysis_number` tetap diambil dari kolom `sample_analysis_number` bila ada. Tanggal menerima `YYYY-MM-DD` atau `DD/MM/YYYY` (boleh disertai jam) dan, untuk Excel, serial tanggal. Untuk ekspor lama, `tgljawab` diprioritaskan karena kolom `blnthn` (periode laporan) berasal dari tanggal tersebut; urutan prioritasi dapat diubah di `src/lib/constants.ts` (`legacyRegistrationDateKeys`).

Saat impor, baris dengan provinsi kosong atau tanggal tidak valid dilewati dan jumlahnya ditampilkan setelah proses. Pada CSV, kolom wajib lain yang kosong tetap menyebabkan impor berhenti dengan pesan kesalahan; pada Excel, baris seperti itu dilewati dan dihitung sebagai "kolom wajib kosong" agar satu baris buruk tidak menggagalkan seluruh file. Kolom `interpretasi_hasil` boleh kosong (atau tidak disertakan jika hasil belum tersedia); data akan tersimpan tanpa hasil dan tidak dihitung sebagai positif. Kolom kabupaten dan kecamatan dipakai untuk mencocokkan warna peta ke wilayahnya.

Jika database Supabase sudah dibuat sebelumnya, jalankan ulang `supabase/schema.sql` agar kolom `interpretasi_hasil` menerima nilai kosong.

Setiap file CSV/Excel yang diimpor admin menambahkan baris ke tabel data yang sama. File yang berisi beberapa tahun (misalnya ekspor 2018–2022) dipecah otomatis menjadi satu entri impor per tahun, sehingga tetap bisa dihapus per tahun. Data dari semua tahun tampil bersama di dashboard. Daftar impor di Panel Admin mencatat nama file, tahun, dan jumlah baris; menghapus satu file menghapus hanya baris dari impor tersebut. Mengimpor file yang sama lagi akan menambahkan duplikat. Data yang sudah ada sebelum daftar impor tersedia ditampilkan sebagai **Data lama** per tahun karena nama file sumbernya tidak tercatat; menghapus entri lama menghapus data lama pada tahun itu. Panel Admin juga menyediakan **Hapus semua data**, dengan konfirmasi mengetik `HAPUS SEMUA DATA`.

## Dashboard Olah Data dan Dashboard Peta

Kedua dashboard adalah halaman React yang mengambil data agregat langsung dari fungsi Supabase `public_iv_lab_dashboard_data()`. Hasilnya di-cache di browser selama 5 menit melalui `src/api/dashboardData.ts`, sehingga berpindah antara Olah Data dan Peta Wilayah tidak perlu mengagregasi ulang seluruh data. Cache dibersihkan otomatis setelah admin menambah, mengimpor, atau menghapus data; tombol **Muat ulang data** pada masing-masing dashboard juga memaksa pengambilan data baru.

- **Olah Data** (`src/pages/ChartsPage.tsx`): grafik dan tabel ringkasan sampel, positif, dan seropositif per metode uji, hari, bulan, tahun, dan provinsi. Dimensi **Per Metode Uji** dan **Per Penyakit** tersedia sebagai checkbox yang bisa dicentang keduanya; kedua grafik lalu ditampilkan bertumpuk ke bawah dengan tinggi baris yang longgar agar label tidak saling menimpa. Filter tahun/provinsi/penyakit juga berupa checkbox multi-select (AI/influenza digabung menjadi “Influenza”). Tersedia tab tabel dan cakupan data, pencarian, pengurutan, serta unduh CSV/PNG. Data per penyakit diambil dari baris `target` pada RPC dashboard; angka positif pada tampilan ini sudah termasuk seropositif.
- **Peta Wilayah** (`src/pages/MapPage.tsx`): peta status wilayah per provinsi, kabupaten/kota, dan kecamatan dengan filter checkbox tahun, provinsi, kabupaten/kota, kecamatan, status, dan penyakit (bisa dipilih beberapa sekaligus). Tersedia mode presentasi, zoom/pan, sorotan batas wilayah beranimasi saat kursor melintas, label kecamatan kecil, grid koordinat di tepi peta, tabel wilayah, serta ekspor PNG, CSV, GeoJSON, cetak, dan **paket QGIS (.zip)**. Paket QGIS berisi `Peta_Sumbagsel.qgz` beserta layer GeoJSON dan atribut status; setelah diekstrak ke satu folder, project langsung menampilkan peta lengkap dengan warna status, batas, dan label sesuai level peta saat diekspor (EPSG:4326). Geometri batas wilayah (GADM 3.6 yang disederhanakan) tersimpan di `src/data/peta.json`.

Komponen filter checkbox bersama ada di `src/components/MultiSelect.tsx` dengan gaya di `src/styles/multiselect.css`.

Impor CSV/Excel dan input manual hanya tersedia di **Panel Admin**. Dashboard publik tidak menerima file CSV/Excel; data grafik dan peta dikirim melalui fungsi agregasi Supabase tanpa membuka kode sampel atau data baris per baris. Navigasi menggunakan menu di header aplikasi.

Dashboard publik selalu tersedia di tautan pertama tanpa tombol admin. Area admin tidak menyediakan tautan langsung ke beranda pengguna: buka `/admin`, login, lalu gunakan menu **Pengelolaan data** di beranda admin. Tombol **Keluar** mengakhiri sesi dan kembali ke form login. Untuk kembali ke situs publik, buka URL `/` secara terpisah.

## Struktur utama

```
src/
  App.tsx                 tema, autentikasi, dan aksi admin
  api/supabase.ts         klien Supabase
  api/dashboardData.ts    cache hasil agregasi dashboard bersama
  data/peta.json          geometri dan batas wilayah
  lib/
    routing.ts            pemetaan URL publik (/), admin (/admin), dan halaman admin
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
