import pool from './db.js';
import type { LeaderboardEntry } from '$lib/types.js';

export type LeaderboardType = 'cluster' | 'user';

// Temporarily hidden from public leaderboards at the cluster admins' request.
const HIDDEN_LEADERBOARD_CLUSTER_NAMES = ['archer2', 'cirrus'];

export async function getLeaderboardEntries(
	type: LeaderboardType,
	limit = 10
): Promise<LeaderboardEntry[]> {
	const result = await pool.query<LeaderboardEntry>(
		`SELECT cluster_name, username, report_type, utilisation_score, scheduler_type, country, job_count, ranking_score
		 FROM reports
		 WHERE show_on_leaderboard = true
		   AND (report_type = $2 OR ($2 = 'cluster' AND report_type IS NULL))
		   AND (CASE WHEN $2 = 'cluster' THEN cluster_name IS NOT NULL ELSE username IS NOT NULL END)
		   AND (cluster_name IS NULL OR lower(trim(cluster_name)) <> ALL($3::text[]))
		 ORDER BY ranking_score DESC
		 LIMIT $1`,
		[limit, type, HIDDEN_LEADERBOARD_CLUSTER_NAMES]
	);

	return result.rows;
}
