import type { RequestHandler } from './$types';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

let fontData: ArrayBuffer | null = null;

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
		console.error('OG landing font error:', err);
		throw err;
	}
}

/** Static OG image for the landing page. Cached for 7 days. */
export const GET: RequestHandler = async () => {
	let font: ArrayBuffer;
	try {
		font = await getFont();
	} catch {
		return new Response('Font unavailable', { status: 500 });
	}

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
							style: {
								fontSize: '56px',
								fontWeight: 'bold',
								color: '#141413',
								textAlign: 'center',
								lineHeight: '1.2',
								marginBottom: '24px'
							},
							children: 'How much compute is your cluster wasting?'
						}
					},
					{
						type: 'div',
						props: {
							style: {
								fontSize: '24px',
								color: '#73726D',
								textAlign: 'center',
								marginBottom: '40px'
							},
							children: 'One command. 30 seconds. Shareable report.'
						}
					},
					{
						type: 'div',
						props: {
							style: {
								display: 'flex',
								backgroundColor: '#141413',
								borderRadius: '12px',
								padding: '20px 32px',
								marginBottom: '40px'
							},
							children: [
								{
									type: 'div',
									props: {
										style: { color: '#22C55E', fontSize: '20px', marginRight: '12px' },
										children: '$'
									}
								},
								{
									type: 'div',
									props: {
										style: { color: '#FFFFFF', fontSize: '18px', fontFamily: 'IBM Plex Sans' },
										children: 'curl -s https://wastage.expanse.sh/scan -o scan.sh && bash scan.sh'
									}
								}
							]
						}
					},
					{
						type: 'div',
						props: {
							style: {
								display: 'flex',
								gap: '16px',
								fontSize: '18px',
								color: '#73726D'
							},
							children: [
								{
									type: 'div',
									props: { children: 'wastage.expanse.sh' }
								},
								{
									type: 'div',
									props: {
										style: { color: '#F26522' },
										children: 'YC P26'
									}
								}
							]
						}
					}
				]
			}
		},
		{
			width: 1200,
			height: 630,
			fonts: [{ name: 'IBM Plex Sans', data: font, weight: 400, style: 'normal' }]
		}
	);

	const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
	const png = resvg.render().asPng();

	return new Response(png, {
		headers: {
			'Content-Type': 'image/png',
			'Cache-Control': 'public, max-age=604800'
		}
	});
};
