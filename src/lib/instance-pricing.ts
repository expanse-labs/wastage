/** Hourly on-demand pricing (USD) for common AWS and GCP instance types. */
export const INSTANCE_PRICES: Record<string, number> = {
	// AWS General Purpose
	'm5.xlarge': 0.192, 'm5.2xlarge': 0.384, 'm5.4xlarge': 0.768, 'm5.8xlarge': 1.536, 'm5.12xlarge': 2.304,
	'm6i.xlarge': 0.192, 'm6i.2xlarge': 0.384, 'm6i.4xlarge': 0.768, 'm6i.8xlarge': 1.536,
	'm6g.xlarge': 0.154, 'm6g.2xlarge': 0.308, 'm6g.4xlarge': 0.616,
	'm7i.xlarge': 0.2016, 'm7i.2xlarge': 0.4032, 'm7i.4xlarge': 0.8064,
	'm7g.xlarge': 0.1632, 'm7g.2xlarge': 0.3264, 'm7g.4xlarge': 0.6528,
	// AWS Compute Optimised
	'c5.xlarge': 0.17, 'c5.2xlarge': 0.34, 'c5.4xlarge': 0.68, 'c5.9xlarge': 1.53,
	'c6i.xlarge': 0.17, 'c6i.2xlarge': 0.34, 'c6i.4xlarge': 0.68,
	'c6g.xlarge': 0.136, 'c6g.2xlarge': 0.272, 'c6g.4xlarge': 0.544,
	'c7g.xlarge': 0.145, 'c7g.2xlarge': 0.29, 'c7g.4xlarge': 0.58,
	// AWS Memory Optimised
	'r5.xlarge': 0.252, 'r5.2xlarge': 0.504, 'r5.4xlarge': 1.008,
	'r6i.xlarge': 0.252, 'r6i.2xlarge': 0.504, 'r6i.4xlarge': 1.008,
	// AWS GPU
	'p3.2xlarge': 3.06, 'p3.8xlarge': 12.24, 'p3.16xlarge': 24.48,
	'p4d.24xlarge': 32.77,
	'p5.48xlarge': 98.32,
	'g4dn.xlarge': 0.526, 'g4dn.2xlarge': 0.752, 'g4dn.4xlarge': 1.204, 'g4dn.8xlarge': 2.176, 'g4dn.12xlarge': 3.912,
	'g5.xlarge': 1.006, 'g5.2xlarge': 1.212, 'g5.4xlarge': 1.624, 'g5.8xlarge': 2.448, 'g5.12xlarge': 5.672,
	'g6.xlarge': 0.8048, 'g6.2xlarge': 0.978, 'g6.4xlarge': 1.3232,
	// GCP General Purpose
	'n1-standard-1': 0.0475, 'n1-standard-2': 0.095, 'n1-standard-4': 0.19, 'n1-standard-8': 0.38, 'n1-standard-16': 0.76,
	'n2-standard-2': 0.0971, 'n2-standard-4': 0.1942, 'n2-standard-8': 0.3884,
	'e2-standard-2': 0.067, 'e2-standard-4': 0.134, 'e2-standard-8': 0.268,
	// GCP GPU
	'a2-highgpu-1g': 3.67, 'a2-highgpu-2g': 7.35, 'a2-highgpu-4g': 14.69,
	'a2-ultragpu-1g': 5.0, 'a2-ultragpu-2g': 10.0,
	'a3-highgpu-8g': 28.0,
};

/** Look up the hourly on-demand price for an instance type. Returns null if unknown. */
export function getInstancePrice(instanceType: string): number | null {
	return INSTANCE_PRICES[instanceType] ?? null;
}
