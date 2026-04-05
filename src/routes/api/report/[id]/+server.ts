import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import pool from '$lib/server/db.js';

/** Return the full report JSON for a given report ID. Cached for 1 hour. */
export const GET: RequestHandler = async ({ params }) => {
	const { id } = params;

	if (!/^[A-Za-z0-9]{12}$/.test(id)) {
		return json({ error: 'Invalid report ID' }, { status: 400 });
	}

	try {
		const result = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);

		if (result.rows.length === 0) {
			return json({ error: 'Report not found' }, { status: 404 });
		}

		return json(result.rows[0], {
			headers: { 'Cache-Control': 'public, max-age=3600' }
		});
	} catch (err) {
		console.error('Report fetch error:', err);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
