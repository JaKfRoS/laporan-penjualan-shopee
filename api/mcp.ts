import { getSupabaseAdmin } from './_lib/db';
import { sha256Hex } from './_lib/crypto';
import { getOrigin, parseBody } from './_lib/oauthConfig';
import { callTool, TOOLS } from './_lib/tools';
import { withErrorHandling } from './_lib/withErrorHandling';

// Endpoint MCP (JSON-RPC lewat HTTP POST). SETIAP request wajib token valid -
// termasuk "initialize" - supaya klien yang belum punya token selalu kena 401
// dengan header WWW-Authenticate yang mengarahkannya ke discovery OAuth
// (/.well-known/oauth-protected-resource). Ini yang memicu custom connector
// di claude.ai untuk mulai alur login, bukan cuma dipakai setelah initialize.

async function resolveUserId(authHeader: string | undefined): Promise<string | null> {
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const supabaseAdmin = getSupabaseAdmin();
  const tokenHash = sha256Hex(token);
  const { data, error } = await supabaseAdmin
    .from('mcp_access_tokens')
    .select('user_id, expires_at')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle();
  if (error || !data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  supabaseAdmin.from('mcp_access_tokens').update({ last_used_at: new Date().toISOString() }).eq('token_hash', tokenHash).then(() => {});
  return data.user_id;
}

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export default withErrorHandling(async function handler(req: any, res: any) {
  const userId = await resolveUserId(req.headers.authorization);
  if (!userId) {
    const origin = getOrigin(req);
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`);
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  if (req.method === 'GET') {
    res.status(405).json({ error: 'Streaming GET tidak didukung di endpoint ini.' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Gunakan POST.' });
    return;
  }

  const body = parseBody(req);
  const { id, method, params } = body || {};

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    res.status(202).end();
    return;
  }

  if (method === 'initialize') {
    res.status(200).json(
      jsonRpcResult(id, {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'shopee-sales-report', version: '1.0.0' },
      })
    );
    return;
  }

  if (method === 'ping') {
    res.status(200).json(jsonRpcResult(id, {}));
    return;
  }

  if (method === 'tools/list') {
    res.status(200).json(jsonRpcResult(id, { tools: TOOLS }));
    return;
  }

  if (method === 'tools/call') {
    try {
      const result = await callTool(userId, params?.name, params?.arguments || {});
      res.status(200).json(jsonRpcResult(id, result));
    } catch (err: any) {
      res.status(200).json(
        jsonRpcResult(id, { content: [{ type: 'text', text: `Error: ${err.message || String(err)}` }], isError: true })
      );
    }
    return;
  }

  res.status(400).json(jsonRpcError(id, -32601, `Method "${method}" tidak didukung.`));
});
