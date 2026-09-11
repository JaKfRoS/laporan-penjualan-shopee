// Dev-only: satu-satunya akun yang boleh menyelesaikan login OAuth ini sekarang.
// Untuk membuka ke akun lain (multi-tenant), hapus pengecekan yang memakai
// konstanta ini di api/authorize.ts - mekanisme OAuth-nya sendiri sudah
// generik (siapa pun yang login lewat Supabase Auth akan diberi token yang
// discope ke akunnya sendiri lewat resolveUserId di api/_lib/tools.ts).
export const DEV_ALLOWED_USER_ID = '8b32c6d1-39a0-4f42-8d72-64e673692d93';

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 jam
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 hari
export const AUTH_CODE_TTL_SECONDS = 120; // 2 menit

export function getOrigin(req: { headers: Record<string, any> }): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string);
  return `${proto}://${host}`;
}

export function parseBody(req: { body: any }): Record<string, any> {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return Object.fromEntries(new URLSearchParams(req.body));
  }
}
