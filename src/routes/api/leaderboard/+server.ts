import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import pool from '$lib/server/db.js';

/** Top entries ranked by utilisation score. Filter by ?type=cluster or ?type=user. */
export const GET: RequestHandler = async ({ url }) => {
	const rawLimit = parseInt(url.searchParams.get('limit') || '10');
	const limit = isNaN(rawLimit) ? 10 : Math.min(Math.max(rawLimit, 1), 100);
	const type = url.searchParams.get('type') === 'user' ? 'user' : 'cluster';

	try {
		const result = await pool.query(
			`SELECT cluster_name, username, report_type, utilisation_score, scheduler_type, country, job_count, ranking_score
			 FROM reports
			 WHERE show_on_leaderboard = true
			   AND (report_type = $2 OR ($2 = 'cluster' AND report_type IS NULL))
			   AND (CASE WHEN $2 = 'cluster' THEN cluster_name IS NOT NULL ELSE username IS NOT NULL END)
			 ORDER BY ranking_score DESC
			 LIMIT $1`,
			[limit, type]
		);

		return json(result.rows, {
			headers: { 'Cache-Control': 'public, max-age=30' }
		});
	} catch (err) {
		console.error('Leaderboard error:', err);
		return json([], { status: 500 });
	}
};
