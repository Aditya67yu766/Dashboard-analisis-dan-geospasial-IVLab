import type { Page } from '../types';

/**
 * Routing berbasis URL untuk memisahkan dua tautan akses:
 *
 *   /                 → beranda publik (link 1)
 *   /ringkasan-data   → dashboard olah data
 *   /peta-wilayah     → dashboard peta
 *   /admin            → login / beranda admin (link 2)
 *   /admin/panel      → panel pengelolaan data
 *
 * `/admin` sengaja dipakai bersama oleh login dan beranda admin: kontennya
 * ditentukan oleh status sesi, bukan oleh URL saja.
 */

const PATHS: Record<Page, string> = {
  home: '/',
  charts: '/ringkasan-data',
  map: '/peta-wilayah',
  login: '/admin',
  'admin-home': '/admin',
  admin: '/admin/panel'
};

export function isAdminArea(page: Page): boolean {
  return page === 'login' || page === 'admin-home' || page === 'admin';
}

export function pageFromLocation(): Page {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === PATHS.admin) return 'admin';
  if (path === PATHS.login) return 'login';
  if (path === PATHS.charts) return 'charts';
  if (path === PATHS.map) return 'map';
  return 'home';
}

/** Menyesuaikan halaman dengan status login (URL /admin dipakai login dan beranda admin). */
export function normalizePage(page: Page, signedInAsAdmin: boolean): Page {
  if (!signedInAsAdmin && (page === 'admin-home' || page === 'admin')) return 'login';
  if (signedInAsAdmin && page === 'login') return 'admin-home';
  return page;
}

export function writeLocation(page: Page, replace = false): void {
  const path = PATHS[page];
  if (window.location.pathname === path) return;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
}
