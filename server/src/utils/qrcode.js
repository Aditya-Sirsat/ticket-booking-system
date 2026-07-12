const QRCode = require('qrcode');

// Encodes the booking reference (and event id) into a QR code as a data URL (PNG, base64).
async function generateTicketQr(bookingRef, eventId) {
  const payload = JSON.stringify({ ref: bookingRef, eventId });
  return QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 300 });
}

module.exports = { generateTicketQr };
