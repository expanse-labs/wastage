/** Aggregate waste report for a single cluster scan. */
export interface Report {
	id: string;
	created_at: string;
	scheduler_type: 'slurm' | 'kubernetes';
	job_count: number;
	node_count: number;
	avg_cpu_waste_pct: number;
	avg_mem_waste_pct: number;
	avg_gpu_core_waste_pct: number | null;
	avg_gpu_mem_waste_pct: number | null;
	gpu_jobs: number;
	gpu_hours: number;
	total_estimated_cost_usd: number;
	utilisation_score: number;
	ranking_score: number;
	cluster_name: string | null;
	country: string | null;
	show_on_leaderboard: boolean;
	histogram_cpu: Record<string, number> | null;
	histogram_mem: Record<string, number> | null;
	cost_per_core_hour: number;
	categories: Record<string, CategoryWaste> | null;
	total_core_hours: number;
	wasted_core_hours: number;
	failed_jobs: number;
	failed_job_pct: number;
	failed_core_pct: number;
	report_type: 'cluster' | 'user';
	username: string | null;
}

/** Per-category waste breakdown for Kubernetes workloads. */
export interface CategoryWaste {
	pod_count: number;
	cpu_waste: number;
	mem_waste: number;
	cost: number;
}

/** Aggregate counters displayed on the landing page. */
export interface GlobalStats {
	total_jobs: number;
	total_waste_usd: number;
	total_core_hours: number;
	total_wasted_core_hours: number;
	cluster_count: number;
}

/** A single row on the utilisation leaderboard (cluster or user). */
export interface LeaderboardEntry {
	cluster_name: string | null;
	username: string | null;
	report_type: 'cluster' | 'user';
	utilisation_score: number;
	scheduler_type: string;
	country: string | null;
	job_count: number;
	ranking_score: number;
}
