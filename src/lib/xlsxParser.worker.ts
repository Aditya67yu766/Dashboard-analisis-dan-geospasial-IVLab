import { parseWorkbook } from './xlsxCore';
import type { ParsedImport } from './importRecord';

type WorkerRequest = { buffer: ArrayBuffer };

type WorkerResponse =
  | { type: 'progress'; processed: number; valid: number }
  | { type: 'done'; result: ParsedImport }
  | { type: 'error'; message: string };

// `self` pada file worker bertipe Window di konfigurasi TS proyek ini, jadi
// dipersempit ke antarmuka yang benar-benar dipakai.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

scope.onmessage = (event) => {
  try {
    const result = parseWorkbook(event.data.buffer, (processed, valid) => {
      scope.postMessage({ type: 'progress', processed, valid });
    });
    scope.postMessage({ type: 'done', result });
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
};
