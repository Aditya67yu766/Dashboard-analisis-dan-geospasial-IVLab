import XlsxWorker from './xlsxParser.worker?worker';
import type { ParsedImport } from './importRecord';

export type SpreadsheetProgress = (processed: number, valid: number) => void;

type WorkerResponse =
  | { type: 'progress'; processed: number; valid: number }
  | { type: 'done'; result: ParsedImport }
  | { type: 'error'; message: string };

/**
 * Membaca file Excel (.xlsx/.xls) tanpa memblokir tampilan.
 * Parsing dijalankan di Web Worker karena file ekspor IV Lab bisa puluhan MB;
 * bila Worker tidak tersedia, parsing dilakukan di thread utama sebagai cadangan.
 */
export async function parseSpreadsheet(
  file: File,
  onProgress?: SpreadsheetProgress
): Promise<ParsedImport> {
  const buffer = await file.arrayBuffer();

  let worker: Worker | null = null;
  if (typeof Worker !== 'undefined') {
    try {
      worker = new XlsxWorker();
    } catch {
      worker = null;
    }
  }

  if (!worker) {
    const { parseWorkbook } = await import('./xlsxCore');
    return parseWorkbook(buffer, onProgress);
  }

  return new Promise<ParsedImport>((resolve, reject) => {
    let receivedMessage = false;

    const finish = () => worker.terminate();

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      receivedMessage = true;
      const message = event.data;
      if (message.type === 'progress') {
        onProgress?.(message.processed, message.valid);
        return;
      }
      if (message.type === 'done') {
        finish();
        resolve(message.result);
        return;
      }
      finish();
      reject(new Error(message.message));
    };

    worker.onerror = () => {
      finish();
      if (receivedMessage) {
        reject(new Error('Gagal memproses file Excel. Coba muat ulang halaman lalu impor kembali.'));
        return;
      }
      // Worker gagal dimuat: proses di thread utama sebagai cadangan.
      void import('./xlsxCore')
        .then(({ parseWorkbook }) => {
          try {
            resolve(parseWorkbook(buffer, onProgress));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        })
        .catch(reject);
    };

    // Tanpa transfer agar buffer tetap tersedia bila perlu fallback.
    worker.postMessage({ buffer });
  });
}
