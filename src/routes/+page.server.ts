import type { PageServerLoad } from './$types';
import pool from '$lib/server/db.js';
import type { GlobalStats, LeaderboardEntry } from '$lib/types.js';

export const load: PageServerLoad = async () => {
	let stats: GlobalStats = { total_jobs: 0, total_waste_usd: 0, total_core_hours: 0, total_wasted_core_hours: 0, cluster_count: 0 };
	let leaderboard: LeaderboardEntry[] = [];

	try {
		const statsResult = await pool.query(`
			SELECT
				COALESCE(SUM(job_count), 0)::int AS total_jobs,
				COALESCE(SUM(total_estimated_cost_usd), 0)::float AS total_waste_usd,
				COALESCE(SUM(total_core_hours), 0)::float AS total_core_hours,
				COALESCE(SUM(wasted_core_hours), 0)::float AS total_wasted_core_hours,
				COUNT(*)::int AS cluster_count
			FROM reports
		`);
		stats = statsResult.rows[0];
	} catch (err) {
		console.error('Stats load error:', err);
	}

	try {
		const lbResult = await pool.query(
			`SELECT cluster_name, utilisation_score, scheduler_type, country, job_count, ranking_score
			 FROM reports
			 WHERE show_on_leaderboard = true AND cluster_name IS NOT NULL
			 ORDER BY ranking_score DESC
			 LIMIT 10`
		);
		leaderboard = lbResult.rows;
	} catch (err) {
		console.error('Leaderboard load error:', err);
	}

	return { stats, leaderboard };
};
