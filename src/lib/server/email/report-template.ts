/**
 * HTML email template for waste report delivery.
 *
 * Uses the Expanse light theme to match wastage.expanse.sh:
 * Surface #FAF9F5, Foreground #141413, Card #FFFFFF, Muted #73726D,
 * Elevated #E8E6DD, IBM Plex Sans, JetBrains Mono.
 */

import type { Report } from '$lib/types.js';

function scoreColour(score: number): string {
	if (score >= 70) return '#059669';
	if (score >= 40) return '#D97706';
	return '#DC2626';
}

function formatCurrency(n: number): string {
	return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function wasteBar(pct: number): string {
	const filled = Math.round((pct / 100) * 10);
	const empty = 10 - filled;
	return '█'.repeat(filled) + '░'.repeat(empty);
}

/** Generate the HTML body for a waste report email. */
export function renderReportEmail(report: Report, reportUrl: string): { html: string; text: string } {
	const score = report.utilisation_score ?? 0;
	const cpuWaste = report.avg_cpu_waste_pct ?? 0;
	const memWaste = report.avg_mem_waste_pct ?? 0;
	const cost = report.total_estimated_cost_usd ?? 0;
	const colour = scoreColour(score);
	const scheduler = report.scheduler_type === 'slurm' ? 'SLURM' : 'Kubernetes';
	const jobLabel = report.scheduler_type === 'slurm' ? 'jobs' : 'pods';

	const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0; padding:0; background-color:#FAF9F5; font-family:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAF9F5; padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;">

          <!-- Header -->
          <tr>
            <td style="padding:24px 40px; border-bottom:1px solid #E8E6DD;">
              <span style="font-family:'IBM Plex Sans',sans-serif; font-size:14px; font-weight:700; color:#141413; letter-spacing:-0.3px;">wastage.expanse.sh</span>
              <span style="float:right; font-size:11px; color:#9C9B96; background:#E8E6DD; padding:4px 10px; border-radius:12px;">YC P26</span>
            </td>
          </tr>

          <!-- Score hero -->
          <tr>
            <td style="padding:40px; text-align:center; background-color:#FFFFFF;">
              <p style="margin:0 0 8px; font-size:13px; color:#73726D; text-transform:uppercase; letter-spacing:1px;">
                Utilisation Score
              </p>
              <p style="margin:0 0 16px; font-size:64px; font-weight:700; color:${colour}; font-family:'JetBrains Mono','IBM Plex Sans',monospace;">
                ${score.toFixed(0)}/100
              </p>
              <p style="margin:0; font-size:14px; color:#73726D;">
                ${report.cluster_name || 'Anonymous cluster'} ·
                <span style="display:inline-block; padding:2px 8px; font-size:11px; font-weight:500; border-radius:10px; background:${report.scheduler_type === 'slurm' ? '#DBEAFE' : '#EDE9FE'}; color:${report.scheduler_type === 'slurm' ? '#1E40AF' : '#6D28D9'};">${scheduler}</span>
                · ${report.job_count.toLocaleString()} ${jobLabel} analysed
              </p>
            </td>
          </tr>

          <!-- Stats row -->
          <tr>
            <td style="padding:24px 40px;">
              <table width="100%" cellpadding="0" cellspacing="8">
                <tr>
                  <td width="33%" style="text-align:center; padding:20px 12px; background-color:#FFFFFF; border:1px solid #E8E6DD; border-radius:12px;">
                    <p style="margin:0 0 4px; font-size:24px; font-weight:700; color:#DC2626; font-family:'JetBrains Mono',monospace;">
                      ${formatCurrency(cost)}
                    </p>
                    <p style="margin:0; font-size:12px; color:#73726D;">estimated waste</p>
                  </td>
                  <td width="33%" style="text-align:center; padding:20px 12px; background-color:#FFFFFF; border:1px solid #E8E6DD; border-radius:12px;">
                    <p style="margin:0 0 4px; font-size:24px; font-weight:700; color:#141413; font-family:'JetBrains Mono',monospace;">
                      ${cpuWaste.toFixed(0)}%
                    </p>
                    <p style="margin:0; font-size:12px; color:#73726D;">CPU waste</p>
                  </td>
                  <td width="33%" style="text-align:center; padding:20px 12px; background-color:#FFFFFF; border:1px solid #E8E6DD; border-radius:12px;">
                    <p style="margin:0 0 4px; font-size:24px; font-weight:700; color:#141413; font-family:'JetBrains Mono',monospace;">
                      ${memWaste.toFixed(0)}%
                    </p>
                    <p style="margin:0; font-size:12px; color:#73726D;">memory waste</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${report.failed_jobs > 0 ? `
          <!-- Failed jobs -->
          <tr>
            <td style="padding:0 40px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FEF2F2; border:1px solid #FECACA; border-radius:8px;">
                <tr>
                  <td style="padding:14px 20px;">
                    <p style="margin:0; font-size:14px; color:#991B1B;">
                      <strong>${report.failed_job_pct?.toFixed(0)}% of ${jobLabel} failed</strong>
                      — ${report.failed_jobs.toLocaleString()} ${jobLabel}, consuming ${report.failed_core_pct?.toFixed(0)}% of total compute.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ` : ''}

          <!-- CTA button -->
          <tr>
            <td style="padding:0 40px 32px; text-align:center;">
              <a href="${reportUrl}" style="display:inline-block; padding:14px 32px; background-color:#141413; color:#FAF9F5; font-size:14px; font-weight:600; text-decoration:none; border-radius:8px;">
                View Full Report →
              </a>
            </td>
          </tr>

          <!-- Expanse CTA -->
          <tr>
            <td style="padding:0 40px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#E8E6DD; border-radius:12px;">
                <tr>
                  <td style="padding:24px;">
                    <p style="margin:0 0 10px; font-size:16px; font-weight:600; color:#141413;">
                      This is ~10% of what Expanse shows you.
                    </p>
                    <p style="margin:0 0 16px; font-size:14px; color:#73726D; line-height:1.6;">
                      Install Expanse on your cluster (free) for live CPU, memory, and GPU utilisation per job,
                      per-user waste breakdown, and API integration for your existing tools.
                    </p>
                    <a href="https://app.expanse.sh" style="display:inline-block; padding:10px 24px; background-color:#141413; color:#FAF9F5; font-size:13px; font-weight:600; text-decoration:none; border-radius:6px;">
                      Get Started Free →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px; border-top:1px solid #E8E6DD;">
              <p style="margin:0 0 6px; font-size:12px; color:#9C9B96;">
                Focus on research, not resources.
              </p>
              <p style="margin:0; font-size:11px; color:#9C9B96;">
                Expanse Compute Inc. · YC P26 · <a href="https://expanse.sh" style="color:#141413; text-decoration:none;">expanse.sh</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

	const text = `COMPUTE WASTE REPORT — wastage.expanse.sh

Utilisation Score: ${score.toFixed(0)}/100
${report.cluster_name || 'Anonymous cluster'} · ${scheduler} · ${report.job_count.toLocaleString()} ${jobLabel} analysed

CPU Waste:    ${cpuWaste.toFixed(0)}%  ${wasteBar(cpuWaste)}
Memory Waste: ${memWaste.toFixed(0)}%  ${wasteBar(memWaste)}
${report.gpu_jobs > 0 ? `GPU Jobs:     ${report.gpu_jobs} (${report.gpu_hours.toFixed(0)} GPU-hours)\n` : ''}
Estimated Waste: ${formatCurrency(cost)}
${report.failed_jobs > 0 ? `Failed: ${report.failed_job_pct?.toFixed(0)}% of ${jobLabel} (${report.failed_core_pct?.toFixed(0)}% of compute)\n` : ''}
View full report: ${reportUrl}

---
This is ~10% of what Expanse shows you.
Install Expanse free: https://app.expanse.sh

Expanse Compute Inc. · YC P26
Focus on research, not resources.`;

	return { html, text };
}
