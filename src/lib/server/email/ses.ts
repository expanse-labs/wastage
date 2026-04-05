/**
 * AWS SES email client for sending waste report emails.
 *
 * Uses the shared AWS credentials from the monorepo's app-secrets.
 * Sends from reports@getexpanse.io via SES in eu-west-2.
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { env } from '$env/dynamic/private';

const ses = new SESClient({
	region: env.AWS_REGION || 'eu-west-2',
	credentials: {
		accessKeyId: env.AWS_ACCESS_KEY_ID || '',
		secretAccessKey: env.AWS_SECRET_ACCESS_KEY || ''
	}
});

const FROM = env.EMAIL_FROM || 'reports@getexpanse.io';

export interface EmailParams {
	to: string;
	subject: string;
	html: string;
	text: string;
}

/** Send an email via AWS SES. Logs to console in development. */
export async function sendEmail({ to, subject, html, text }: EmailParams): Promise<void> {
	if (env.NODE_ENV !== 'production') {
		console.log(`[email] Would send to ${to}: ${subject}`);
		return;
	}

	await ses.send(
		new SendEmailCommand({
			Source: `Expanse <${FROM}>`,
			Destination: { ToAddresses: [to] },
			Message: {
				Subject: { Data: subject, Charset: 'UTF-8' },
				Body: {
					Html: { Data: html, Charset: 'UTF-8' },
					Text: { Data: text, Charset: 'UTF-8' }
				}
			}
		})
	);
}
