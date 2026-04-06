import type { PageServerLoad } from './$types';
import pool from '$lib/server/db.js';
import type { GlobalStats, LeaderboardEntry } from '$lib/types.js';

export const load: PageServerLoad = async () => {
	let stats: GlobalStats = { total_jobs: 0, total_waste_usd: 0, total_core_hours: 0, total_wasted_core_hours: 0, cluster_count: 0 };
	let clusterLeaderboard: LeaderboardEntry[] = [];
	let userLeaderboard: LeaderboardEntry[] = [];

	try {
		const statsResult = await pool.query(`
			SELECT
				COALESCE(SUM(job_count), 0)::int AS total_jobs,
				COALESCE(SUM(total_estimated_cost_usd), 0)::float AS total_waste_usd,
				COALESCE(SUM(total_core_hours), 0)::float AS total_core_hours,
				COALESCE(SUM(wasted_core_hours), 0)::float AS total_wasted_core_hours,
				COUNT(*) FILTER (WHERE report_type = 'cluster' OR report_type IS NULL)::int AS cluster_count
			FROM reports
		`);
		stats = statsResult.rows[0];
	} catch (err) {
		console.error('Stats load error:', err);
	}

	try {
		const clusterResult = await pool.query(
			`SELECT cluster_name, username, report_type, utilisation_score, scheduler_type, country, job_count, ranking_score
			 FROM reports
			 WHERE show_on_leaderboard = true AND report_type = 'cluster' AND cluster_name IS NOT NULL
			 ORDER BY ranking_score DESC
			 LIMIT 10`
		);
		clusterLeaderboard = clusterResult.rows;
	} catch (err) {
		console.error('Cluster leaderboard error:', err);
	}

	try {
		const userResult = await pool.query(
			`SELECT cluster_name, username, report_type, utilisation_score, scheduler_type, country, job_count, ranking_score
			 FROM reports
			 WHERE show_on_leaderboard = true AND report_type = 'user' AND username IS NOT NULL
			 ORDER BY ranking_score DESC
			 LIMIT 10`
		);
		userLeaderboard = userResult.rows;
	} catch (err) {
		console.error('User leaderboard error:', err);
	}

	return { stats, clusterLeaderboard, userLeaderboard };
};
