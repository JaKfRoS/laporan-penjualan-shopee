import { getSupabaseAdmin } from './_lib/db';
import { randomToken, sha256Hex, sha256Base64Url } from './_lib/crypto';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, parseBody } from './_lib/oauthConfig';
import { withErrorHandling } from './_lib/withErrorHandling';

async function issueTokenPair(userId: string, clientId: string, scope: string | null) {
  const supabaseAdmin = getSupabaseAdmin();
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString();

  const { error: atErr } = await supabaseAdmin.from('mcp_access_tokens').insert({
    user_id: userId,
    token_hash: sha256Hex(accessToken),
    label: 'oauth',
    client_id: clientId,
    expires_at: accessExpiresAt,
  });
  if (atErr) throw new Error(atErr.message);

  const { error: rtErr } = await supabaseAdmin.from('mcp_refresh_tokens').insert({
    user_id: userId,
    client_id: clientId,
    token_hash: sha256Hex(refreshToken),
    expires_at: refreshExpiresAt,
  });
  if (rtErr) throw new Error(rtErr.message);

  return { accessToken, refreshToken, expiresAt: accessExpiresAt, scope };
}

export default withErrorHandling(async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const supabaseAdmin = getSupabaseAdmin();
  const body = parseBody(req);
  const grant_type = body.grant_type;

  if (grant_type === 'authorization_code') {
    const { code, redirect_uri, client_id, code_verifier } = body;
    if (!code || !redirect_uri || !client_id || !code_verifier) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }

    const codeHash = sha256Hex(code);
    const { data: authCode, error } = await supabaseAdmin
      .from('oauth_authorization_codes')
      .select('*')
      .eq('code_hash', codeHash)
      .maybeSingle();

    if (error || !authCode || authCode.used_at || authCode.client_id !== client_id || authCode.redirect_uri !== redirect_uri) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }
    if (new Date(authCode.expires_at) < new Date()) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Kode otorisasi sudah kedaluwarsa.' });
      return;
    }
    if (sha256Base64Url(code_verifier) !== authCode.code_challenge) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE code_verifier tidak cocok.' });
      return;
    }

    await supabaseAdmin.from('oauth_authorization_codes').update({ used_at: new Date().toISOString() }).eq('code_hash', codeHash);

    try {
      const tokens = await issueTokenPair(authCode.user_id, client_id, authCode.scope);
      res.status(200).json({
        access_token: tokens.accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: tokens.refreshToken,
        scope: tokens.scope,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'server_error', error_description: err.message });
    }
    return;
  }

  if (grant_type === 'refresh_token') {
    const { refresh_token, client_id } = body;
    if (!refresh_token || !client_id) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }

    const tokenHash = sha256Hex(refresh_token);
    const { data: rt, error } = await supabaseAdmin
      .from('mcp_refresh_tokens')
      .select('*')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .maybeSingle();

    if (error || !rt || rt.client_id !== client_id || new Date(rt.expires_at) < new Date()) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }

    // Rotasi: cabut refresh token lama, terbitkan pasangan baru.
    await supabaseAdmin.from('mcp_refresh_tokens').update({ revoked_at: new Date().toISOString() }).eq('token_hash', tokenHash);

    try {
      const tokens = await issueTokenPair(rt.user_id, client_id, null);
      res.status(200).json({
        access_token: tokens.accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: tokens.refreshToken,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'server_error', error_description: err.message });
    }
    return;
  }

  res.status(400).json({ error: 'unsupported_grant_type' });
});
