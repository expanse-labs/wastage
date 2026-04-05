import { migrate } from '$lib/server/migrate.js';

let migrated = false;

/** Run database migrations once on first request, then pass through. */
export async function handle({ event, resolve }) {
	if (!migrated) {
		try {
			await migrate();
			migrated = true;
			console.log('Database migration complete');
		} catch (err) {
			console.error('Migration failed:', err);
		}
	}
	return resolve(event);
}
