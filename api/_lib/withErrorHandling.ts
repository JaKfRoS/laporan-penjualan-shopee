// Membungkus tiap handler supaya error tak terduga (termasuk env var belum
// diset, lihat db.ts) mendarat sebagai respons JSON yang jelas, bukan crash
// function mentah tanpa pesan (FUNCTION_INVOCATION_FAILED).
export function withErrorHandling(fn: (req: any, res: any) => Promise<void> | void) {
  return async (req: any, res: any) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      console.error(err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'server_error', error_description: err?.message || String(err) });
      }
    }
  };
}
