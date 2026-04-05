import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import pool from '$lib/server/db.js';

/** Top clusters ranked by utilisation score. Opt-in only. Cached for 30 seconds. */
export const GET: RequestHandler = async ({ url }) => {
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 100);

	try {
		const result = await pool.query(
			`SELECT cluster_name, utilisation_score, scheduler_type, country, job_count, ranking_score
			 FROM reports
			 WHERE show_on_leaderboard = true AND cluster_name IS NOT NULL
			 ORDER BY ranking_score DESC
			 LIMIT $1`,
			[limit]
		);

		return json(result.rows, {
			headers: { 'Cache-Control': 'public, max-age=30' }
		});
	} catch (err) {
		console.error('Leaderboard error:', err);
		return json([], { status: 500 });
	}
};
