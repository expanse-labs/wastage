/**
 * Zod schemas for API request validation.
 *
 * All ingest payloads are validated here before touching the database.
 * Histogram verification catches fabricated waste reports (anti-spoofing).
 */

import { z } from 'zod';

const histogramSchema = z.record(z.string(), z.number().int().min(0));

const categorySchema = z.record(
	z.string(),
	z.object({
		pod_count: z.number().int().min(0),
		cpu_waste: z.number().min(0).max(100),
		mem_waste: z.number().min(0).max(100),
		cost: z.number().min(0)
	})
);

export const ingestSchema = z.object({
	scheduler_type: z.enum(['slurm', 'kubernetes']),
	job_count: z.number().int().min(1).max(1000000),
	node_count: z.number().int().min(0).max(100000).optional().default(0),
	avg_cpu_waste_pct: z.number().min(0).max(100),
	avg_mem_waste_pct: z.number().min(0).max(100),
	avg_gpu_core_waste_pct: z.number().min(0).max(100).nullable().optional(),
	avg_gpu_mem_waste_pct: z.number().min(0).max(100).nullable().optional(),
	gpu_jobs: z.number().int().min(0).max(100000).optional().default(0),
	gpu_hours: z.number().min(0).max(1000000).optional().default(0),
	total_estimated_cost_usd: z.number().min(0).max(1000000),
	utilisation_score: z.number().min(0).max(100),
	cluster_name: z
		.string()
		.max(50)
		.regex(/^[a-zA-Z0-9 \-]*$/)
		.nullable()
		.optional(),
	country: z.string().max(100).nullable().optional(),
	show_on_leaderboard: z.boolean().optional().default(false),
	email: z.string().email().max(254).nullable().optional(),
	histogram_cpu: histogramSchema.optional(),
	histogram_mem: histogramSchema.optional(),
	cost_per_core_hour: z.number().min(0).max(1000).optional().default(0.10),
	total_core_hours: z.number().min(0).optional().default(0),
	wasted_core_hours: z.number().min(0).optional().default(0),
	failed_jobs: z.number().int().min(0).optional().default(0),
	failed_job_pct: z.number().min(0).max(100).optional().default(0),
	failed_core_pct: z.number().min(0).max(100).optional().default(0),
	categories: categorySchema.nullable().optional()
});

export type IngestPayload = z.infer<typeof ingestSchema>;

export const emailCaptureSchema = z.object({
	report_id: z.string().min(1).max(20),
	email: z.string().email().max(254)
});

/**
 * Verify that a waste histogram is consistent with the reported average.
 * Catches fabricated reports where someone sends a fake average without
 * constructing a matching distribution.
 */
export function validateHistogram(
	histogram: Record<string, number> | undefined,
	reportedAvg: number,
	jobCount: number
): boolean {
	if (!histogram) return true;

	const buckets = Object.entries(histogram);
	if (buckets.length === 0) return true;

	let totalJobs = 0;
	let weightedSum = 0;

	for (const [range, count] of buckets) {
		totalJobs += count;
		const parts = range.split('-');
		if (parts.length !== 2) return false;
		const low = parseFloat(parts[0]);
		const high = parseFloat(parts[1]);
		if (isNaN(low) || isNaN(high)) return false;
		const midpoint = (low + high) / 2;
		weightedSum += midpoint * count;
	}

	if (totalJobs !== jobCount) return false;

	const histogramAvg = totalJobs > 0 ? weightedSum / totalJobs : 0;
	if (Math.abs(histogramAvg - reportedAvg) > 5) return false;

	for (const [, count] of buckets) {
		if (count / totalJobs > 0.9) return false;
	}

	return true;
}
