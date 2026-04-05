import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import pool from '$lib/server/db.js';

/** Liveness probe. Returns 503 if the database is unreachable. */
export const GET: RequestHandler = async () => {
	try {
		await pool.query('SELECT 1');
		return json({ status: 'ok' });
	} catch {
		return json({ status: 'error', message: 'Database unreachable' }, { status: 503 });
	}
};
