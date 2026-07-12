// Sends transactional email via Brevo's REST API (https://api.brevo.com) instead of SMTP.
//
// Why: most free-tier PaaS hosts (Render, Heroku, etc.) block outbound traffic on SMTP
// ports 25/465/587 to stop free accounts being abused for spam. That makes Gmail/SMTP
// mail permanently unreachable from a free web service, no matter how it's configured.
// Brevo's API travels over HTTPS (port 443) — the same port your app already uses for
// every other outbound request — so it isn't blocked. This also drops the `nodemailer`
// dependency entirely, since Node 18+ ships a native `fetch`.

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const REQUEST_TIMEOUT_MS = 8000;

async function sendMail({ to, subject, html, attachments }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || 'Ticket Booking';

  if (!apiKey || !senderEmail) {
    console.warn(`⚠️  Brevo not configured — skipping email to ${to}: "${subject}"`);
    return { skipped: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Brevo's API has no support for inline (CID) images, and most webmail clients
  // (Gmail included) strip `data:` URI images out of the HTML body entirely, which is
  // why the QR code must travel as a real `attachment` entry, not an <img src="data:...">
  // tag — see the comment where this is called from.
  const body = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html
  };
  if (attachments && attachments.length > 0) {
    body.attachment = attachments;
  }

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`Brevo API responded ${res.status}: ${errorBody}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { sendMail };
