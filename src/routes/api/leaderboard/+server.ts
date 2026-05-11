import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLeaderboardEntries } from '$lib/server/leaderboard.js';

/** Top entries ranked by utilisation score. Filter by ?type=cluster or ?type=user. */
export const GET: RequestHandler = async ({ url }) => {
	const rawLimit = parseInt(url.searchParams.get('limit') || '10');
	const limit = isNaN(rawLimit) ? 10 : Math.min(Math.max(rawLimit, 1), 100);
	const type = url.searchParams.get('type') === 'user' ? 'user' : 'cluster';

	try {
		const entries = await getLeaderboardEntries(type, limit);

		return json(entries, {
			headers: { 'Cache-Control': 'public, max-age=30' }
		});
	} catch (err) {
		console.error('Leaderboard error:', err);
		return json([], { status: 500 });
	}
};
