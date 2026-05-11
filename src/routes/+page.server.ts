import type { PageServerLoad } from './$types';
import pool from '$lib/server/db.js';
import { getLeaderboardEntries } from '$lib/server/leaderboard.js';
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
		clusterLeaderboard = await getLeaderboardEntries('cluster');
	} catch (err) {
		console.error('Cluster leaderboard error:', err);
	}

	try {
		userLeaderboard = await getLeaderboardEntries('user');
	} catch (err) {
		console.error('User leaderboard error:', err);
	}

	return { stats, clusterLeaderboard, userLeaderboard };
};
