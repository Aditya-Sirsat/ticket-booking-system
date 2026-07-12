const QRCode = require('qrcode');

// Encodes the booking reference (and event id) into a QR code as a data URL (PNG, base64).
// Stored as-is in `bookings.qr_data_url` so the frontend (My Bookings page) can render it
// directly in an <img> tag in-app — browsers don't strip data: URIs, only email clients do.
async function generateTicketQr(bookingRef, eventId) {
  const payload = JSON.stringify({ ref: bookingRef, eventId });
  return QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 300 });
}

// Strips the "data:image/png;base64," prefix off a data URL, leaving the raw base64
// payload Brevo's `attachment[].content` field expects.
function qrDataUrlToBase64(dataUrl) {
  return dataUrl.split(',')[1];
}

module.exports = { generateTicketQr, qrDataUrlToBase64 };
