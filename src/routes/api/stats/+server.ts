import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import pool from '$lib/server/db.js';

/** Aggregate counters across all reports. Cached for 30 seconds. */
export const GET: RequestHandler = async () => {
	try {
		const result = await pool.query(`
			SELECT
				COALESCE(SUM(job_count), 0)::int AS total_jobs,
				COALESCE(SUM(total_estimated_cost_usd), 0)::float AS total_waste_usd,
				COALESCE(SUM(total_core_hours), 0)::float AS total_core_hours,
				COALESCE(SUM(wasted_core_hours), 0)::float AS total_wasted_core_hours,
				COUNT(*)::int AS cluster_count
			FROM reports
		`);

		const stats = result.rows[0];

		return json(stats, {
			headers: { 'Cache-Control': 'public, max-age=30', 'Access-Control-Allow-Origin': 'https://expanse.sh' }
		});
	} catch (err) {
		console.error('Stats error:', err);
		return json(
			{ total_jobs: 0, total_waste_usd: 0, total_core_hours: 0, total_wasted_core_hours: 0, cluster_count: 0 },
			{ status: 500 }
		);
	}
};
