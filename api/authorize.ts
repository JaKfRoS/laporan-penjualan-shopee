import { getSupabaseAdmin } from './_lib/db.js';
import { randomToken, sha256Hex } from './_lib/crypto.js';
import { DEV_ALLOWED_USER_ID, AUTH_CODE_TTL_SECONDS, parseBody } from './_lib/oauthConfig.js';
import { withErrorHandling } from './_lib/withErrorHandling.js';

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}

function renderLoginPage(params: Record<string, string>, error?: string) {
  const hidden = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Masuk - Shopee Analytics</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: system-ui, sans-serif; background: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { background: white; padding: 2rem; border-radius: 1.5rem; box-shadow: 0 10px 30px rgba(0,0,0,.08); width: 100%; max-width: 380px; }
  h1 { font-size: 1.1rem; margin: 0 0 .25rem; color: #0f172a; }
  p.sub { color: #64748b; font-size: .85rem; margin: 0 0 1.5rem; line-height: 1.4; }
  label { font-size: .75rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
  input[type=email], input[type=password] { width: 100%; box-sizing: border-box; padding: .65rem .9rem; margin: .35rem 0 1rem; border: 1px solid #e2e8f0; border-radius: .75rem; font-size: .95rem; }
  button { width: 100%; padding: .75rem; background: #2563eb; color: white; border: none; border-radius: .75rem; font-weight: 800; font-size: .9rem; cursor: pointer; }
  .error { background: #fef2f2; color: #b91c1c; padding: .6rem .9rem; border-radius: .75rem; font-size: .85rem; margin-bottom: 1rem; }
</style></head>
<body>
  <form class="card" method="POST">
    <h1>Hubungkan ke Shopee Analytics</h1>
    <p class="sub">Masuk dengan akun yang sama seperti di dashboard untuk mengizinkan akses baca data ke Claude.</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <label>Email</label>
    <input type="email" name="email" required autofocus>
    <label>Password</label>
    <input type="password" name="password" required>
    ${hidden}
    <button type="submit">Masuk &amp; Izinkan</button>
  </form>
</body></html>`;
}

export default withErrorHandling(async function handler(req: any, res: any) {
  const supabaseAdmin = getSupabaseAdmin();
  const isPost = req.method === 'POST';
  const source: Record<string, any> = isPost ? parseBody(req) : req.query || {};

  const client_id = String(source.client_id || '');
  const redirect_uri = String(source.redirect_uri || '');
  const state = String(source.state || '');
  const code_challenge = String(source.code_challenge || '');
  const code_challenge_method = String(source.code_challenge_method || '');
  const scope = String(source.scope || 'mcp:read');
  const response_type = String(source.response_type || 'code');

  const passthrough = { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, response_type };

  if (!client_id || !redirect_uri || code_challenge_method !== 'S256' || !code_challenge || response_type !== 'code') {
    res.status(400).send('Permintaan otorisasi tidak valid (parameter wajib hilang, atau PKCE method tidak didukung - harus S256).');
    return;
  }

  const { data: client, error: clientErr } = await supabaseAdmin
    .from('oauth_clients')
    .select('id, redirect_uris')
    .eq('id', client_id)
    .maybeSingle();

  // Logging sementara untuk diagnosa - lihat Vercel function logs.
  console.log('AUTHORIZE_DEBUG', JSON.stringify({
    received_client_id: client_id,
    received_redirect_uri: redirect_uri,
    lookup_error: clientErr?.message || null,
    found_client: client,
  }));

  if (clientErr || !client || !client.redirect_uris.includes(redirect_uri)) {
    res.status(400).send('client_id atau redirect_uri tidak dikenal. Pastikan aplikasi klien sudah terdaftar lewat /api/register.');
    return;
  }

  if (!isPost) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(renderLoginPage(passthrough));
    return;
  }

  const email = String(source.email || '');
  const password = String(source.password || '');

  const { data: signInData, error: signInError } = await supabaseAdmin.auth.signInWithPassword({ email, password });
  if (signInError || !signInData.user) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(renderLoginPage(passthrough, 'Email atau password salah.'));
    return;
  }

  if (signInData.user.id !== DEV_ALLOWED_USER_ID) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(renderLoginPage(passthrough, 'Akun ini belum diaktifkan untuk akses chat (masih tahap pengembangan).'));
    return;
  }

  const code = randomToken(32);
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000).toISOString();
  const { error: insertErr } = await supabaseAdmin.from('oauth_authorization_codes').insert({
    code_hash: sha256Hex(code),
    client_id,
    user_id: signInData.user.id,
    redirect_uri,
    code_challenge,
    scope,
    expires_at: expiresAt,
  });
  if (insertErr) {
    res.status(500).send('Gagal membuat kode otorisasi: ' + insertErr.message);
    return;
  }

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);
  res.writeHead(302, { Location: redirectUrl.toString() });
  res.end();
});
