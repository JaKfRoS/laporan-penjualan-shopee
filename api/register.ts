import crypto from 'node:crypto';
import { supabaseAdmin } from './_lib/db';
import { parseBody } from './_lib/oauthConfig';

// RFC 7591 - Dynamic Client Registration, subset minimal: klien publik (PKCE,
// tanpa client_secret) yang mendaftarkan redirect_uris-nya sendiri.
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const body = parseBody(req);
  const redirectUris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (redirectUris.length === 0) {
    res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris wajib diisi.' });
    return;
  }
  for (const uri of redirectUris) {
    try {
      const u = new URL(uri);
      if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
        res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uri harus HTTPS.' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'invalid_redirect_uri' });
      return;
    }
  }

  const clientId = crypto.randomUUID();
  const clientName = typeof body.client_name === 'string' ? body.client_name.slice(0, 200) : null;
  const { error } = await supabaseAdmin.from('oauth_clients').insert({
    id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
  });
  if (error) {
    res.status(500).json({ error: 'server_error', error_description: error.message });
    return;
  }

  res.status(201).json({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
}
