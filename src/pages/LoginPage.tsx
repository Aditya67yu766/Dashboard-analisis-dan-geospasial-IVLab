import { type FormEvent } from 'react';
import type { FlashType } from '../types';

type LoginPageProps = {
  configured: boolean;
  busy: boolean;
  flash: string;
  flashType: FlashType;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function connectionNotice(configured: boolean) {
  if (!configured) {
    return (
      <div className="notice notice-warn">
        <strong>Supabase belum dikonfigurasi.</strong> Isi <code>.env.local</code> saat menjalankan lokal atau environment variables di Vercel. Lihat README untuk langkah setup.
      </div>
    );
  }
  return null;
}

export default function LoginPage({ configured: isConfigured, busy, flash, flashType, onSubmit }: LoginPageProps) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">Panel admin</span>
        <h1>Login admin</h1>
        <p>Masuk untuk menginput dan mengelola data laboratorium.</p>
        {connectionNotice(isConfigured)}
        {flash ? <div className={`notice notice-${flashType}`}>{flash}</div> : null}
        <form className="form-stack" onSubmit={onSubmit}>
          <label>Email admin<input type="email" name="email" autoComplete="username" required /></label>
          <label>Kata sandi<input type="password" name="password" autoComplete="current-password" required /></label>
          <button className="button button-dark button-full" type="submit" disabled={!isConfigured || busy}>{busy ? 'Memeriksa…' : 'Masuk ke panel'}</button>
        </form>
        <div className="auth-foot">Akses admin dikelola melalui Supabase Authentication. Login perlu diulang setelah halaman dimuat ulang.</div>
      </section>
      <div className="auth-side"><span className="eyebrow eyebrow-light">Pantau Penyakit · Balai Veteriner Lampung</span><p>Platform pemantauan penyakit hewan dan hasil uji laboratorium veteriner.</p></div>
    </main>
  );
}
