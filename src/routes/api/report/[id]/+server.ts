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
		const result = await pool.query(
			`SELECT id, created_at, scheduler_type, job_count, node_count,
				avg_cpu_waste_pct, avg_mem_waste_pct, avg_gpu_core_waste_pct, avg_gpu_mem_waste_pct,
				gpu_jobs, gpu_hours, total_estimated_cost_usd, utilisation_score, ranking_score,
				cluster_name, country, show_on_leaderboard, histogram_cpu, histogram_mem,
				cost_per_core_hour, categories, total_core_hours, wasted_core_hours,
				failed_jobs, failed_job_pct, failed_core_pct, report_type, username
			FROM reports WHERE id = $1`,
			[id]
		);

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
