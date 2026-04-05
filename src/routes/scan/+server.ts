import type { RequestHandler } from './$types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let scriptContent: string;

/** Serve the bash scanner script as plain text. Cached in-process and for 5 minutes at the edge. */
export const GET: RequestHandler = async () => {
	if (!scriptContent) {
		try {
			scriptContent = readFileSync(resolve('static/scan.sh'), 'utf-8');
		} catch (err) {
			console.error('Failed to read scan.sh:', err);
			return new Response('Script not found', { status: 500 });
		}
	}

	return new Response(scriptContent, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'public, max-age=300'
		}
	});
};
