import pool from './db.js';

/** Run idempotent schema migrations on startup. Safe to call repeatedly. */
export async function migrate() {
	await pool.query(`
		CREATE TABLE IF NOT EXISTS reports (
			id TEXT PRIMARY KEY,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			scheduler_type TEXT NOT NULL,
			job_count INTEGER NOT NULL,
			node_count INTEGER DEFAULT 0,
			avg_cpu_waste_pct REAL,
			avg_mem_waste_pct REAL,
			avg_gpu_core_waste_pct REAL,
			avg_gpu_mem_waste_pct REAL,
			gpu_jobs INTEGER DEFAULT 0,
			gpu_hours REAL DEFAULT 0,
			total_estimated_cost_usd REAL,
			utilisation_score REAL,
			ranking_score REAL,
			cluster_name TEXT,
			country TEXT,
			show_on_leaderboard BOOLEAN DEFAULT FALSE,
			ip_hash TEXT,
			histogram_cpu JSONB,
			histogram_mem JSONB,
			cost_per_core_hour REAL DEFAULT 0.10,
			categories JSONB,
			total_core_hours REAL DEFAULT 0,
			wasted_core_hours REAL DEFAULT 0,
			failed_jobs INTEGER DEFAULT 0,
			failed_job_pct REAL DEFAULT 0,
			failed_core_pct REAL DEFAULT 0
		);

		CREATE TABLE IF NOT EXISTS email_captures (
			id SERIAL PRIMARY KEY,
			report_id TEXT REFERENCES reports(id),
			email TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_reports_leaderboard
			ON reports(ranking_score DESC)
			WHERE show_on_leaderboard = true;

		CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);
	`);
}
