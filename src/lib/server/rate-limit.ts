/**
 * In-memory IP-based rate limiter.
 *
 * 1,000 requests per IP per 24-hour sliding window. Resets on pod restart,
 * which is acceptable for a safety net against scripted abuse.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REQUESTS = 1000;

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of store) {
		if (now >= entry.resetAt) {
			store.delete(key);
		}
	}
}, 10 * 60 * 1000);

/** Check whether a request from this IP is within the rate limit. */
export function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
	const now = Date.now();
	const entry = store.get(ip);

	if (!entry || now >= entry.resetAt) {
		store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
		return { allowed: true };
	}

	entry.count++;
	if (entry.count > MAX_REQUESTS) {
		const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
		return { allowed: false, retryAfter };
	}

	return { allowed: true };
}

/**
 * Extract the client IP from the request.
 * Uses the rightmost X-Forwarded-For entry (appended by ALB, not spoofable).
 */
export function extractIp(request: Request): string {
	const forwarded = request.headers.get('x-forwarded-for');
	if (forwarded) {
		const parts = forwarded.split(',').map((s) => s.trim());
		return parts[parts.length - 1];
	}
	return '127.0.0.1';
}
