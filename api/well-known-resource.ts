import { getOrigin } from './_lib/oauthConfig.js';
import { withErrorHandling } from './_lib/withErrorHandling.js';

// RFC 9728 - Protected Resource Metadata, untuk endpoint MCP (/api/mcp).
export default withErrorHandling(function handler(req: any, res: any) {
  const origin = getOrigin(req);
  res.status(200).json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
  });
});
