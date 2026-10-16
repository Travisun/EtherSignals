import crypto from 'crypto';

/** Bitget v2 signature: base64(hmac-sha256(secret, timestamp + METHOD + requestPath + query + body)) */
export function bitgetSign(opts: {
  secret: string;
  timestamp: number | string;
  method: string;
  requestPath: string;
  queryString?: string;
  body?: string;
}): string {
  const { secret, timestamp, method, requestPath, queryString = '', body = '' } = opts;
  const message = `${timestamp}${method.toUpperCase()}${requestPath}${queryString ? `?${queryString}` : ''}${body}`;
  return crypto.createHmac('sha256', secret).update(message).digest('base64');
}

/** Signature for the WS private login handshake. */
export function bitgetWsLoginSign(secret: string, timestamp: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}GET/user/verify`).digest('base64');
}
