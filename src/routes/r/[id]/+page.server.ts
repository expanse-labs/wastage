import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import pool from '$lib/server/db.js';
import type { Report } from '$lib/types.js';

export const load: PageServerLoad = async ({ params }) => {
	const { id } = params;

	if (!/^[A-Za-z0-9]{12}$/.test(id)) {
		error(404, 'Report not found');
	}

	const result = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);

	if (result.rows.length === 0) {
		error(404, 'Report not found. Run the scanner to create one.');
	}

	const report: Report = result.rows[0];
	return { report };
};
