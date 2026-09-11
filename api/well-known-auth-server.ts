import { getOrigin } from './_lib/oauthConfig';
import { withErrorHandling } from './_lib/withErrorHandling';

// RFC 8414 - Authorization Server Metadata. Client publik + PKCE saja (tanpa
// client_secret) karena semua klien (termasuk Claude) mendaftar sendiri lewat
// Dynamic Client Registration (/api/register) dan tidak bisa menyimpan secret
// dengan aman.
export default withErrorHandling(function handler(req: any, res: any) {
  const origin = getOrigin(req);
  res.status(200).json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/authorize`,
    token_endpoint: `${origin}/api/token`,
    registration_endpoint: `${origin}/api/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp:read'],
  });
});
