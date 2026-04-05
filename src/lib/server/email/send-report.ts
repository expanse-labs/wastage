/**
 * Send a waste report email to a user after ingest.
 *
 * Called asynchronously after the report is stored. Failures are logged
 * but do not block the ingest response.
 */

import { sendEmail } from './ses.js';
import { renderReportEmail } from './report-template.js';
import type { Report } from '$lib/types.js';

export async function sendReportEmail(report: Report, email: string): Promise<void> {
	const reportUrl = `https://wastage.expanse.sh/r/${report.id}`;
	const score = (report.utilisation_score ?? 0).toFixed(0);
	const { html, text } = renderReportEmail(report, reportUrl);

	try {
		await sendEmail({
			to: email,
			subject: `Your cluster scores ${score}/100 — Compute Waste Report`,
			html,
			text
		});
	} catch (err) {
		console.error(`Failed to send report email to ${email}:`, err);
	}
}
