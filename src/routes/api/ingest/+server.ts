import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import pool from '$lib/server/db.js';
import { generateReportId } from '$lib/server/id.js';
import { checkRateLimit, extractIp } from '$lib/server/rate-limit.js';
import { ingestSchema, validateHistogram } from '$lib/validation.js';
import { sendReportEmail } from '$lib/server/email/send-report.js';
import { createHash } from 'crypto';
import { env } from '$env/dynamic/private';

const IP_SALT = env.IP_HASH_SALT;
if (!IP_SALT) {
	console.warn('IP_HASH_SALT not set. IP hashes will use a weak default. Set this in production.');
}
const SALT = IP_SALT || crypto.randomUUID();

/** Accept an aggregate waste report from the CLI scanner and store it. */
export const POST: RequestHandler = async ({ request }) => {
	const contentLength = parseInt(request.headers.get('content-length') ?? '-1');
	if (contentLength < 0 || contentLength > 4096) {
		return json({ error: 'Request too large' }, { status: 413 });
	}

	const ip = extractIp(request);
	const { allowed, retryAfter } = checkRateLimit(ip);
	if (!allowed) {
		return json(
			{ error: 'Rate limit exceeded. Try again later.' },
			{ status: 429, headers: { 'Retry-After': String(retryAfter) } }
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const result = ingestSchema.safeParse(body);
	if (!result.success) {
		return json({ error: 'Validation failed', details: result.error.issues }, { status: 400 });
	}

	const data = result.data;

	if (!validateHistogram(data.histogram_cpu, data.avg_cpu_waste_pct)) {
		return json({ error: 'CPU histogram inconsistent with reported averages' }, { status: 400 });
	}
	if (!validateHistogram(data.histogram_mem, data.avg_mem_waste_pct)) {
		return json({ error: 'Memory histogram inconsistent with reported averages' }, { status: 400 });
	}

	const id = generateReportId();
	const jobCount = data.job_count;
	const rankingScore =
		data.utilisation_score * Math.min(1, Math.log10(Math.max(jobCount, 1)) / 4);
	const ipHash = createHash('sha256').update(ip + SALT).digest('hex');
	const showOnLeaderboard = data.show_on_leaderboard && jobCount >= 50;

	try {
		await pool.query(
			`INSERT INTO reports (
				id, scheduler_type, job_count, node_count,
				avg_cpu_waste_pct, avg_mem_waste_pct,
				avg_gpu_core_waste_pct, avg_gpu_mem_waste_pct,
				gpu_jobs, gpu_hours, total_estimated_cost_usd,
				utilisation_score, ranking_score,
				cluster_name, country, show_on_leaderboard, ip_hash,
				histogram_cpu, histogram_mem, cost_per_core_hour, categories,
				total_core_hours, wasted_core_hours, failed_jobs, failed_job_pct, failed_core_pct
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
			[
				id,
				data.scheduler_type,
				data.job_count,
				data.node_count,
				data.avg_cpu_waste_pct,
				data.avg_mem_waste_pct,
				data.avg_gpu_core_waste_pct ?? null,
				data.avg_gpu_mem_waste_pct ?? null,
				data.gpu_jobs,
				data.gpu_hours,
				data.total_estimated_cost_usd,
				data.utilisation_score,
				rankingScore,
				data.cluster_name ?? null,
				data.country ?? null,
				showOnLeaderboard,
				ipHash,
				data.histogram_cpu ? JSON.stringify(data.histogram_cpu) : null,
				data.histogram_mem ? JSON.stringify(data.histogram_mem) : null,
				data.cost_per_core_hour,
				data.categories ? JSON.stringify(data.categories) : null,
				data.total_core_hours,
				data.wasted_core_hours,
				data.failed_jobs,
				data.failed_job_pct,
				data.failed_core_pct
			]
		);

		if (data.email) {
			await pool.query(
				'INSERT INTO email_captures (report_id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING',
				[id, data.email]
			);

			// Send report email asynchronously (don't block the response)
			const report = { id, ...data, ranking_score: rankingScore } as any;
			sendReportEmail(report, data.email).catch(() => {});
		}

		return json({ id, url: `https://wastage.expanse.sh/r/${id}` });
	} catch (err) {
		console.error('Ingest error:', err);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
