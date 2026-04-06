import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import pool from '$lib/server/db.js';
import type { Report } from '$lib/types.js';

export const load: PageServerLoad = async ({ params }) => {
	const { id } = params;

	if (!/^[A-Za-z0-9]{12}$/.test(id)) {
		error(404, 'Report not found');
	}

	let result;
	try {
		result = await pool.query(
			`SELECT id, created_at, scheduler_type, job_count, node_count,
				avg_cpu_waste_pct, avg_mem_waste_pct, avg_gpu_core_waste_pct, avg_gpu_mem_waste_pct,
				gpu_jobs, gpu_hours, total_estimated_cost_usd, utilisation_score, ranking_score,
				cluster_name, country, show_on_leaderboard, histogram_cpu, histogram_mem,
				cost_per_core_hour, categories, total_core_hours, wasted_core_hours,
				failed_jobs, failed_job_pct, failed_core_pct, report_type, username
			FROM reports WHERE id = $1`,
			[id]
		);
	} catch (err) {
		console.error('Report page DB error:', err);
		error(500, 'Something went wrong. Please try again.');
	}

	if (result.rows.length === 0) {
		error(404, 'Report not found. Run the scanner to create one.');
	}

	const report: Report = result.rows[0];
	return { report };
};
