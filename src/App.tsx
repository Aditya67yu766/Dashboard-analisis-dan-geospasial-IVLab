import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { clearDashboardCache, prefetchDashboardData } from './api/dashboardData';
import { configured, supabase } from './api/supabase';
import { parseCsv } from './lib/csv';
import { nullable, numberFormat } from './lib/constants';
import { isAdminArea, normalizePage, pageFromLocation, writeLocation } from './lib/routing';
import AdminPage from './pages/AdminPage';
import HomePage from './pages/HomePage';
import AdminHomePage from './pages/AdminHomePage';
import LoginPage from './pages/LoginPage';
import ReauthModal from './pages/ReauthModal';

// Halaman dashboard publik dipisah dari bundle utama agar beranda lebih ringan.
// AdminPage sengaja tetap di bundle utama: alur input admin tidak berubah.
const ChartsPage = lazy(() => import('./pages/ChartsPage'));
const MapPage = lazy(() => import('./pages/MapPage'));
import type {
  FlashMessage,
  FlashType,
  ImportRow,
  Page,
  ReauthState,
  RecordRow,
  SensitiveAction,
  Session,
  Summary
} from './types';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function App() {
  const [page, setPage] = useState<Page>(() => pageFromLocation());
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('thm') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [importsLoading, setImportsLoading] = useState(false);
  const [reauth, setReauth] = useState<ReauthState | null>(null);
  const [flash, setFlash] = useState<FlashMessage | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('thm', theme);
    } catch {
      // localStorage can be unavailable in private mode.
    }
  }, [theme]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 9000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    let cancelled = false;
    let adminReady = false;

    async function initialize() {
      // Sesi admin hanya relevan pada tautan admin (/admin dan /admin/panel).
      if (supabase && isAdminArea(pageFromLocation())) {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled) return;
        if (error) {
          setFlash({ text: `Sesi admin tidak dapat diperiksa: ${error.message}`, type: 'error' });
        } else if (data.session) {
          try {
            await authenticateAdminSession(data.session as Session);
            adminReady = true;
          } catch (authError) {
            const { error: signOutError } = await supabase.auth.signOut();
            if (cancelled) return;
            setSession(null);
            setIsAdmin(false);
            setPage('login');
            writeLocation('login', true);
            setFlash({
              text: `${errorMessage(authError)}${signOutError ? ` Sesi gagal ditutup: ${signOutError.message}` : ''}`,
              type: 'error'
            });
          }
        }
      }
      if (cancelled) return;
      if (pageFromLocation() === 'admin' && !adminReady) {
        // Akses langsung ke /admin/panel tanpa sesi diarahkan ke halaman login.
        writeLocation('login', true);
        setPage('login');
      }
      await loadSummary();
    }

    void initialize();
    return () => { cancelled = true; };
    // The initial session check intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const next = normalizePage(pageFromLocation(), isAdmin);
      writeLocation(next, true);
      setPage(next);
      setFlash(null);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isAdmin]);

  async function loadSummary() {
    if (!supabase) return;
    setSummaryError('');
    const { data, error } = await supabase.rpc('public_iv_lab_summary');
    if (error) {
      setSummaryError(error.message);
      setSummary(null);
      return;
    }
    setSummary(data as Summary);
  }

  async function loadAdminRecords() {
    if (!supabase) return;
    setRecordsLoading(true);
    const { data, error } = await supabase
      .from('iv_lab_records')
      .select('id, import_id, registration_date, kode_sampel, nama_uji, interpretasi_hasil, provinsi')
      .order('created_at', { ascending: false })
      .limit(50);
    setRecordsLoading(false);
    if (error) {
      setRecords([]);
      setFlash({ text: `Data admin gagal dimuat: ${error.message}`, type: 'error' });
      return;
    }
    setRecords((data ?? []) as RecordRow[]);
  }

  async function loadAdminImports() {
    if (!supabase) return;
    setImportsLoading(true);
    const { data, error } = await supabase
      .from('iv_lab_imports')
      .select('id, file_name, data_year, record_count, skipped_province_count, status, created_at')
      .order('created_at', { ascending: false });
    setImportsLoading(false);
    if (error) {
      setImports([]);
      setFlash({ text: `Daftar file impor gagal dimuat: ${error.message}`, type: 'error' });
      return;
    }
    setImports((data ?? []) as ImportRow[]);
  }

  async function refreshAfterChange() {
    clearDashboardCache();
    await Promise.all([loadSummary(), loadAdminRecords(), loadAdminImports()]);
  }

  async function authenticateAdminSession(nextSession: Session) {
    if (!supabase) throw new Error('Supabase belum dikonfigurasi.');
    const { data: admin, error: adminError } = await supabase
      .from('iv_lab_admins')
      .select('user_id')
      .eq('user_id', nextSession.user.id)
      .maybeSingle();
    if (adminError) throw new Error(`Tidak dapat memverifikasi akses admin: ${adminError.message}`);
    if (!admin) throw new Error('Akun ini belum didaftarkan sebagai admin.');

    setSession(nextSession);
    setIsAdmin(true);
    // Setelah login selalu masuk ke beranda admin, bukan langsung ke panel.
    setPage('admin-home');
    writeLocation('admin-home', true);
    setFlash({ text: 'Berhasil masuk.', type: 'success' });
    await Promise.all([loadAdminRecords(), loadAdminImports()]);
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setFlash(null);
    const form = new FormData(event.currentTarget);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(form.get('email') ?? '').trim(),
      password: String(form.get('password') ?? '')
    });
    if (error) {
      setBusy(false);
      setFlash({ text: `Login gagal: ${error.message}`, type: 'error' });
      return;
    }
    try {
      if (!data.session) throw new Error('Sesi login tidak tersedia.');
      await authenticateAdminSession(data.session as Session);
    } catch (authError) {
      const { error: signOutError } = await supabase.auth.signOut();
      setSession(null);
      setIsAdmin(false);
      setPage('login');
      writeLocation('login', true);
      setFlash({
        text: `${errorMessage(authError)}${signOutError ? ` Sesi gagal ditutup: ${signOutError.message}` : ''}`,
        type: 'error'
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      setFlash({ text: `Gagal keluar: ${error.message}`, type: 'error' });
      return;
    }
    setSession(null);
    setIsAdmin(false);
    setReauth(null);
    setRecords([]);
    setImports([]);
    setPage('login');
    writeLocation('login', true);
    setFlash(null);
  }

  function beginSensitiveAction(action: SensitiveAction) {
    setReauth({ step: 'password', action });
    setFlash(null);
  }

  async function handleReauth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !reauth || busy) return;
    const user = session?.user;
    if (!user?.email) {
      setFlash({ text: 'Email akun admin tidak tersedia. Silakan keluar dan masuk kembali.', type: 'error' });
      return;
    }
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setBusy(true);
    setFlash(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email: user.email, password });
    setBusy(false);
    if (error) {
      setFlash({ text: `Verifikasi kata sandi gagal: ${error.message}`, type: 'error' });
      return;
    }
    if (data.user.id !== user.id) {
      await handleSignOut();
      setFlash({ text: 'Akun berubah saat verifikasi. Silakan masuk kembali.', type: 'error' });
      return;
    }
    if (data.session) setSession(data.session as Session);
    const { action } = reauth;
    setReauth(null);
    await performSensitiveAction(action);
  }

  async function performSensitiveAction(action: SensitiveAction) {
    if (action.type === 'record') await performDeleteRecord(action.id);
    else if (action.type === 'import') await performDeleteImport(action.id);
    else await performDeleteAllRecords();
  }

  function requestDeleteRecord(id: string) {
    if (!supabase || !isAdmin || busy) return;
    if (!window.confirm('Hapus data sampel ini?')) return;
    beginSensitiveAction({ type: 'record', id });
  }

  async function performDeleteRecord(id: string) {
    if (!supabase) return;
    const record = records.find((item) => item.id === id);
    setBusy(true);
    setFlash({ text: 'Menghapus data…', type: 'info' });
    const { error } = await supabase.from('iv_lab_records').delete().eq('id', id);
    if (error) {
      setBusy(false);
      setFlash({ text: `Data gagal dihapus: ${error.message}`, type: 'error' });
      return;
    }

    if (record?.import_id) {
      const { count, error: countError } = await supabase
        .from('iv_lab_records')
        .select('id', { count: 'exact', head: true })
        .eq('import_id', record.import_id);
      if (countError) {
        setFlash({ text: `Data berhasil dihapus, tetapi jumlah baris pada daftar impor tidak dapat diperbarui: ${countError.message}`, type: 'error' });
      } else {
        const { error: importUpdateError } = await supabase
          .from('iv_lab_imports')
          .update({ record_count: count ?? 0 })
          .eq('id', record.import_id);
        setFlash(importUpdateError
          ? { text: `Data berhasil dihapus, tetapi jumlah baris pada daftar impor tidak dapat diperbarui: ${importUpdateError.message}`, type: 'error' }
          : { text: 'Data berhasil dihapus.', type: 'success' });
      }
    } else {
      setFlash({ text: 'Data berhasil dihapus.', type: 'success' });
    }

    setBusy(false);
    await refreshAfterChange();
  }

  function requestDeleteImport(id: string) {
    if (!supabase || !isAdmin || busy) return;
    const importRecord = imports.find((item) => item.id === id);
    if (!importRecord) return;
    const target = importRecord.status === 'legacy'
      ? `data lama tahun ${importRecord.data_year} (nama file aslinya tidak tercatat)`
      : `file "${importRecord.file_name}" tahun ${importRecord.data_year}`;
    if (!window.confirm(`Hapus ${target} beserta ${numberFormat.format(importRecord.record_count)} baris data? Tindakan ini tidak dapat dibatalkan.`)) return;
    beginSensitiveAction({ type: 'import', id });
  }

  async function performDeleteImport(id: string) {
    if (!supabase) return;
    const importRecord = imports.find((item) => item.id === id);
    if (!importRecord) {
      setFlash({ text: 'Data impor tidak ditemukan. Muat ulang daftar sebelum mencoba lagi.', type: 'error' });
      return;
    }
    setBusy(true);
    setFlash({ text: 'Menghapus data impor…', type: 'info' });
    const { error } = await supabase.from('iv_lab_imports').delete().eq('id', id);
    setBusy(false);
    if (error) {
      setFlash({ text: `Data impor gagal dihapus: ${error.message}`, type: 'error' });
      return;
    }
    setFlash({
      text: importRecord.status === 'legacy' ? 'Data lama tahun tersebut berhasil dihapus.' : 'File dan seluruh data impornya berhasil dihapus.',
      type: 'success'
    });
    await refreshAfterChange();
  }

  function requestDeleteAll() {
    if (!supabase || !isAdmin || busy) return;
    const confirmation = window.prompt(
      'Ini akan menghapus permanen seluruh data IV Lab dari semua tahun. Ketik HAPUS SEMUA DATA untuk melanjutkan.'
    );
    if (confirmation === null) return;
    if (confirmation.trim() !== 'HAPUS SEMUA DATA') {
      setFlash({ text: 'Konfirmasi tidak cocok. Data tidak dihapus.', type: 'error' });
      return;
    }
    beginSensitiveAction({ type: 'all' });
  }

  async function performDeleteAllRecords() {
    if (!supabase) return;
    setBusy(true);
    setFlash({ text: 'Menghapus seluruh data IV Lab…', type: 'info' });

    const { error: importDeleteError } = await supabase
      .from('iv_lab_imports')
      .delete()
      .not('id', 'is', null);
    if (importDeleteError) {
      setBusy(false);
      setFlash({ text: `Daftar impor dan data gagal dihapus: ${importDeleteError.message}`, type: 'error' });
      return;
    }

    const { error: recordDeleteError } = await supabase
      .from('iv_lab_records')
      .delete()
      .not('id', 'is', null);
    setBusy(false);
    if (recordDeleteError) {
      setFlash({ text: `File impor dan data terkait sudah dihapus, tetapi data tanpa catatan impor gagal dihapus: ${recordDeleteError.message}`, type: 'error' });
    } else {
      setRecords([]);
      setImports([]);
      setFlash({ text: 'Seluruh data IV Lab berhasil dihapus.', type: 'success' });
    }
    await refreshAfterChange();
  }

  async function handleAddRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !isAdmin || busy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const record = {
      registration_date: String(form.get('registration_date') ?? ''),
      kode_sampel: String(form.get('kode_sampel') ?? '').trim(),
      nama_uji: String(form.get('nama_uji') ?? '').trim(),
      metode_uji: String(form.get('metode_uji') ?? '').trim(),
      interpretasi_hasil: nullable(form.get('interpretasi_hasil')),
      provinsi: String(form.get('provinsi') ?? '').trim(),
      kabupaten: nullable(form.get('kabupaten')),
      kecamatan: nullable(form.get('kecamatan')),
      no_registrasi: nullable(form.get('no_registrasi')),
      sample_analysis_number: nullable(form.get('sample_analysis_number')),
      hewan: nullable(form.get('hewan')),
      jenis_layanan: nullable(form.get('jenis_layanan'))
    };

    setBusy(true);
    setFlash(null);
    const { error } = await supabase.from('iv_lab_records').insert(record);
    setBusy(false);
    if (error) {
      setFlash({ text: `Data gagal disimpan: ${error.message}`, type: 'error' });
      return;
    }
    formElement.reset();
    setFlash({ text: 'Data sampel berhasil disimpan.', type: 'success' });
    await refreshAfterChange();
  }

  async function handleImportCsv(file: File) {
    if (!supabase || !isAdmin || busy) return;
    setBusy(true);
    setFlash({ text: `Memvalidasi ${file.name}…`, type: 'info' });

    let rows;
    let skippedMissingProvince: number;
    let dataYear: number;
    try {
      const parsed = await parseCsv(file);
      rows = parsed.rows;
      skippedMissingProvince = parsed.skippedMissingProvince;
      if (!rows.length) {
        throw new Error(`Tidak ada baris valid untuk diimpor; ${numberFormat.format(skippedMissingProvince)} baris dilewati karena provinsi kosong.`);
      }
      const years = [...new Set(rows.map((row) => row.registration_date.slice(0, 4)))];
      if (years.length !== 1) {
        throw new Error(`Satu file hanya boleh berisi satu tahun. Tahun yang ditemukan: ${years.join(', ')}.`);
      }
      dataYear = Number(years[0]);
    } catch (error) {
      setBusy(false);
      setFlash({ text: errorMessage(error), type: 'error' });
      return;
    }

    const { data: importRecord, error: importError } = await supabase
      .from('iv_lab_imports')
      .insert({
        file_name: file.name,
        data_year: dataYear,
        skipped_province_count: skippedMissingProvince,
        imported_by: session?.user.id
      })
      .select('id')
      .single();
    if (importError || !importRecord) {
      setBusy(false);
      setFlash({ text: `File gagal dicatat untuk impor: ${importError?.message ?? 'ID impor tidak tersedia.'}`, type: 'error' });
      return;
    }

    let saved = 0;
    for (let index = 0; index < rows.length; index += 500) {
      const batch = rows.slice(index, index + 500).map((row) => ({ ...row, import_id: importRecord.id }));
      const { error } = await supabase.from('iv_lab_records').insert(batch);
      if (error) {
        const status = saved ? 'partial' : 'failed';
        const { error: trackingError } = await supabase
          .from('iv_lab_imports')
          .update({ record_count: saved, status })
          .eq('id', importRecord.id);
        setBusy(false);
        const partial = saved ? `${numberFormat.format(saved)} baris sudah tersimpan sebelum terjadi kesalahan. ` : '';
        const skipped = skippedMissingProvince ? `${numberFormat.format(skippedMissingProvince)} baris dilewati karena provinsi kosong. ` : '';
        const tracking = trackingError ? `Status daftar file gagal diperbarui: ${trackingError.message}. ` : '';
        setFlash({ text: `${partial}${skipped}Impor berhenti: ${error.message}.${tracking}`, type: 'error' });
        await refreshAfterChange();
        return;
      }
      saved += batch.length;
    }

    const { error: trackingError } = await supabase
      .from('iv_lab_imports')
      .update({ record_count: saved, skipped_province_count: skippedMissingProvince, status: 'completed' })
      .eq('id', importRecord.id);
    setBusy(false);
    const skipped = skippedMissingProvince ? ` ${numberFormat.format(skippedMissingProvince)} baris dilewati karena provinsi kosong.` : '';
    setFlash(trackingError
      ? { text: `${numberFormat.format(saved)} baris berhasil diimpor, tetapi status daftar file gagal diperbarui: ${trackingError.message}.${skipped}`, type: 'error' }
      : { text: `${numberFormat.format(saved)} baris berhasil diimpor.${skipped}`, type: 'success' });
    await refreshAfterChange();
  }

  function prefetchDashboard(target?: 'charts' | 'map') {
    if (!target || target === 'charts') void import('./pages/ChartsPage');
    if (!target || target === 'map') void import('./pages/MapPage');
    prefetchDashboardData();
  }

  function prefetchFor(target: Page) {
    if (target === 'charts' || target === 'map') prefetchDashboard(target);
  }

  function navigate(nextPage: Page) {
    const target = normalizePage(nextPage, isAdmin);
    setPage(target);
    writeLocation(target);
    setFlash(null);
    if (target === 'admin') {
      void loadAdminRecords();
      void loadAdminImports();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const navItems: Array<[Page, string]> = [
    ['home', 'Beranda'],
    ['charts', 'Ringkasan Data'],
    ['map', 'Peta Wilayah']
  ];
  const flashText = flash?.text ?? '';
  const flashType: FlashType = flash?.type ?? 'success';
  const loginPanel = (
    <LoginPage
      configured={configured}
      busy={busy}
      flash={flashText}
      flashType={flashType}
      onSubmit={handleSignIn}
    />
  );
  const adminArea = isAdminArea(page);

  return (
    <div className={`app-shell${page === 'charts' || page === 'map' ? ' dash-mode' : ''}`}>
      <header className="site-header">
        <button
          className="brand"
          onClick={() => navigate(adminArea ? (isAdmin ? 'admin-home' : 'login') : 'home')}
          aria-label="Pantau Penyakit beranda"
        >
          <img className="brand-logo" src="/logo-bv-lampung.png" alt="" />
          <span><strong>Pantau Penyakit</strong><small>Balai Veteriner Lampung</small></span>
        </button>

        {adminArea ? (
          isAdmin ? (
            <nav className="main-nav" aria-label="Navigasi admin">
              <button className={page === 'admin-home' ? 'active' : ''} onClick={() => navigate('admin-home')}>
                Beranda admin
              </button>
              <button className={page === 'admin' ? 'active' : ''} onClick={() => navigate('admin')}>
                Pengelolaan data
              </button>
            </nav>
          ) : null
        ) : (
          <nav className="main-nav" aria-label="Navigasi utama">
            {navItems.map(([target, label]) => (
              <button
                key={target}
                className={page === target ? 'active' : ''}
                onClick={() => navigate(target)}
                onMouseEnter={() => prefetchFor(target)}
                onFocus={() => prefetchFor(target)}
              >
                {label}
              </button>
            ))}
          </nav>
        )}

        <div className="header-actions">
          <button
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'Gunakan tema terang' : 'Gunakan tema gelap'}
            aria-label={theme === 'dark' ? 'Gunakan tema terang' : 'Gunakan tema gelap'}
          >
            {theme === 'dark' ? 'Terang' : 'Gelap'}
          </button>
          {adminArea && isAdmin ? (
            <button className="button button-dark" onClick={() => void handleSignOut()}>Keluar</button>
          ) : null}
        </div>
      </header>

      {page === 'home' ? (
        <HomePage
          summary={summary}
          summaryError={summaryError}
          configured={configured}
          isAdmin={false}
          flash={flashText}
          flashType={flashType}
          onPage={(target) => navigate(target)}
          onPrefetch={() => prefetchDashboard()}
        />
      ) : null}

      {page === 'admin-home' && isAdmin ? (
        <AdminHomePage
          summary={summary}
          summaryError={summaryError}
          configured={configured}
          flash={flashText}
          flashType={flashType}
          onPage={(target) => navigate(target)}
          onLogout={() => void handleSignOut()}
          onManage={() => navigate('admin')}
        />
      ) : null}

      {page === 'login' || (page === 'admin-home' && !isAdmin) ? loginPanel : null}

      {page === 'admin' ? (
        isAdmin ? (
          <AdminPage
            records={records}
            recordsLoading={recordsLoading}
            imports={imports}
            importsLoading={importsLoading}
            flash={flashText}
            flashType={flashType}
            busy={busy}
            onAddRecord={handleAddRecord}
            onImportCsv={(file) => void handleImportCsv(file)}
            onDeleteRecord={requestDeleteRecord}
            onDeleteImport={requestDeleteImport}
            onLogout={() => void handleSignOut()}
            onRefreshRecords={() => void loadAdminRecords()}
            onRefreshImports={() => void loadAdminImports()}
            onDeleteAll={requestDeleteAll}
          />
        ) : loginPanel
      ) : null}

      {page === 'charts' ? (
        <Suspense fallback={null}><ChartsPage theme={theme} /></Suspense>
      ) : null}
      {page === 'map' ? (
        <Suspense fallback={null}><MapPage theme={theme} /></Suspense>
      ) : null}

      <footer className="site-footer">
        <span>Pantau Penyakit · Balai Veteriner Lampung</span>
        <span>Data IV Lab · {new Date().getFullYear()}</span>
      </footer>

      <ReauthModal
        reauth={reauth}
        flash={flashText}
        flashType={flashType}
        busy={busy}
        onSubmit={handleReauth}
        onCancel={() => setReauth(null)}
      />
    </div>
  );
}

export default App;
