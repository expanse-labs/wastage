import type { RequestHandler } from './$types';
import pool from '$lib/server/db.js';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

let fontData: ArrayBuffer | null = null;

/** Fetch and cache the IBM Plex Sans font for OG image rendering. */
async function getFont(): Promise<ArrayBuffer> {
	if (fontData) return fontData;
	try {
		const res = await fetch(
			'https://fonts.gstatic.com/s/ibmplexsans/v19/zYXgKVElMYYaJe8bpLHnCwDKhdHeFaxOedc.woff2'
		);
		if (!res.ok) throw new Error(`Font fetch failed: ${res.status}`);
		fontData = await res.arrayBuffer();
		return fontData;
	} catch (err) {
		console.error('Font fetch error:', err);
		throw err;
	}
}

/** Generate a dynamic OG image (1200x630 PNG) for a waste report. Cached for 24 hours. */
export const GET: RequestHandler = async ({ params }) => {
	const { id } = params;

	if (!/^[A-Za-z0-9]{12}$/.test(id)) {
		return new Response('Not found', { status: 404 });
	}

	let result;
	try {
		result = await pool.query(
			'SELECT utilisation_score, total_estimated_cost_usd, job_count, scheduler_type, avg_cpu_waste_pct, avg_mem_waste_pct FROM reports WHERE id = $1',
			[id]
		);
	} catch (err) {
		console.error('OG image DB error:', err);
		return new Response('Internal server error', { status: 500 });
	}

	if (result.rows.length === 0) {
		return new Response('Not found', { status: 404 });
	}

	const r = result.rows[0];
	const score = r.utilisation_score ?? 0;
	const cost = r.total_estimated_cost_usd ?? 0;
	const cpuWaste = r.avg_cpu_waste_pct ?? 0;
	const scoreColor = score >= 70 ? '#059669' : score >= 40 ? '#D97706' : '#DC2626';
	const font = await getFont();

	const svg = await satori(
		{
			type: 'div',
			props: {
				style: {
					width: '1200px',
					height: '630px',
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'center',
					alignItems: 'center',
					backgroundColor: '#FAF9F5',
					fontFamily: 'IBM Plex Sans',
					padding: '60px'
				},
				children: [
					{
						type: 'div',
						props: {
							style: { fontSize: '24px', color: '#73726D', marginBottom: '16px' },
							children: 'wastage.expanse.sh'
						}
					},
					{
						type: 'div',
						props: {
							style: {
								fontSize: '96px',
								fontWeight: 'bold',
								color: scoreColor,
								marginBottom: '8px'
							},
							children: `${score.toFixed(0)}/100`
						}
					},
					{
						type: 'div',
						props: {
							style: { fontSize: '28px', color: '#141413', marginBottom: '32px' },
							children: 'Utilisation Score'
						}
					},
					{
						type: 'div',
						props: {
							style: {
								display: 'flex',
								gap: '48px',
								fontSize: '20px',
								color: '#73726D'
							},
							children: [
								{
									type: 'div',
									props: {
										children: `${r.job_count.toLocaleString()} ${r.scheduler_type === 'slurm' ? 'jobs' : 'pods'} analysed`
									}
								},
								{
									type: 'div',
									props: {
										style: { color: '#DC2626' },
										children: `$${cost.toLocaleString(undefined, { maximumFractionDigits: 0 })} wasted`
									}
								},
								{
									type: 'div',
									props: {
										children: `${cpuWaste.toFixed(0)}% CPU waste`
									}
								}
							]
						}
					},
					{
						type: 'div',
						props: {
							style: {
								fontSize: '18px',
								color: '#9C9B96',
								marginTop: '40px'
							},
							children: 'Powered by Expanse · YC P26'
						}
					}
				]
			}
		},
		{
			width: 1200,
			height: 630,
			fonts: [
				{
					name: 'IBM Plex Sans',
					data: font,
					weight: 400,
					style: 'normal'
				}
			]
		}
	);

	const resvg = new Resvg(svg, {
		fitTo: { mode: 'width', value: 1200 }
	});
	const png = resvg.render().asPng();

	return new Response(png, {
		headers: {
			'Content-Type': 'image/png',
			'Cache-Control': 'public, max-age=86400'
		}
	});
};
