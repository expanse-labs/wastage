/**
 * Shared PostgreSQL connection pool.
 *
 * Capped at 5 connections to be a good neighbour on the shared RDS instance.
 * The pool is created once at module load and reused across all server endpoints.
 */

import pg from 'pg';
import { env } from '$env/dynamic/private';

const pool = new pg.Pool({
	connectionString: env.DATABASE_URL,
	max: 5,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 5000,
	ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
	console.error('Unexpected PostgreSQL pool error:', err);
});

export default pool;
