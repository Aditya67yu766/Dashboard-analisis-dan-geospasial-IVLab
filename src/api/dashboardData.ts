import { supabase } from './supabase';
import type { DashboardData } from '../types';

/**
 * Cache bersama untuk hasil public_iv_lab_dashboard_data().
 * Ringkasan Data dan Peta Wilayah memakai RPC yang sama, jadi tanpa cache
 * kedua halaman akan mengagregasi ulang seluruh data setiap kali dibuka.
 */

const TTL = 5 * 60 * 1000;

let cache: DashboardData | null = null;
let cachedAt = 0;
let pending: Promise<DashboardData> | null = null;
let generation = 0;

/** Hapus cache setelah admin mengubah data (impor, input, atau hapus). */
export function clearDashboardCache(): void {
  cache = null;
  cachedAt = 0;
  generation += 1;
}

export function getCachedDashboardData(): DashboardData | null {
  return cache && Date.now() - cachedAt < TTL ? cache : null;
}

export function hasDashboardCache(): boolean {
  return getCachedDashboardData() !== null;
}

/** Ambil data lebih awal saat user mengarahkan kursor ke menu dashboard. */
export function prefetchDashboardData(): void {
  if (hasDashboardCache()) return;
  void getDashboardData().catch(() => {
    // Error ditangani oleh halaman saat benar-benar membutuhkan data.
  });
}

export async function getDashboardData(): Promise<DashboardData> {
  if (cache && Date.now() - cachedAt < TTL) return cache;
  if (!pending) {
    pending = load().finally(() => { pending = null; });
  }
  return pending;
}

async function load(): Promise<DashboardData> {
  if (!supabase) {
    throw new Error('Supabase belum dikonfigurasi. Isi .env.local lalu muat ulang halaman.');
  }
  const requestedGeneration = generation;
  const { data, error } = await supabase.rpc('public_iv_lab_dashboard_data');
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || !(data as DashboardData).charts) {
    throw new Error('Data ringkasan dari Supabase tidak tersedia.');
  }
  const payload = data as DashboardData;
  // Jika cache dibersihkan saat request masih berjalan, jangan simpan data lama.
  if (requestedGeneration === generation) {
    cache = payload;
    cachedAt = Date.now();
  }
  return payload;
}
