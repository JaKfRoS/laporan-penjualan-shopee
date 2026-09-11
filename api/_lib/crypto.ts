import crypto from 'node:crypto';

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function sha256Base64Url(input: string): string {
  return crypto.createHash('sha256').update(input).digest('base64url');
}
