const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  // Fail fast instead of hanging a booking request if SMTP is unreachable/misconfigured.
  connectionTimeout: 8000,
  greetingTimeout: 8000,
  socketTimeout: 8000
});

async function sendMail({ to, subject, html, attachments }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn(`⚠️  SMTP not configured — skipping email to ${to}: "${subject}"`);
    return { skipped: true };
  }
  return transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
    attachments
  });
}

module.exports = { sendMail };
