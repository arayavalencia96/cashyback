export type RateLimitKeySource =
  'ip' | 'body.email' | 'body.sessionId' | 'body.token' | 'params.uid';

export interface RateLimitRule {
  limit: number;
  windowMs: number;
  keyBy: RateLimitKeySource[];
  message?: string;
  description?: string;
}
