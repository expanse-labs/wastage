import { randomBytes } from 'crypto';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Generate a 12-character cryptographically random alphanumeric report ID. */
export function generateReportId(): string {
	const bytes = randomBytes(12);
	let id = '';
	for (let i = 0; i < 12; i++) {
		id += CHARS[bytes[i] % CHARS.length];
	}
	return id;
}
