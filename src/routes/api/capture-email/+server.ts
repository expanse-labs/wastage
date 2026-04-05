import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import pool from '$lib/server/db.js';
import { emailCaptureSchema } from '$lib/validation.js';
import { checkRateLimit, extractIp } from '$lib/server/rate-limit.js';

/** Store a lead's email address, linked to a specific waste report. */
export const POST: RequestHandler = async ({ request }) => {
	const ip = extractIp(request);
	const { allowed, retryAfter } = checkRateLimit(ip);
	if (!allowed) {
		return json(
			{ error: 'Rate limit exceeded. Try again later.' },
			{ status: 429, headers: { 'Retry-After': String(retryAfter) } }
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const result = emailCaptureSchema.safeParse(body);
	if (!result.success) {
		return json({ error: 'Validation failed', details: result.error.issues }, { status: 400 });
	}

	const { report_id, email } = result.data;

	try {
		const reportCheck = await pool.query('SELECT id FROM reports WHERE id = $1', [report_id]);
		if (reportCheck.rows.length === 0) {
			return json({ error: 'Report not found' }, { status: 400 });
		}

		await pool.query(
			'INSERT INTO email_captures (report_id, email) VALUES ($1, $2)',
			[report_id, email]
		);

		return json({ success: true });
	} catch (err) {
		console.error('Email capture error:', err);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
