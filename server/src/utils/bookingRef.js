const crypto = require('crypto');

// Short, human-friendly, high-entropy booking reference, e.g. "TBK-8F2A9C3D"
function generateBookingRef() {
  return 'TBK-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function generateOfferToken() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = { generateBookingRef, generateOfferToken };
