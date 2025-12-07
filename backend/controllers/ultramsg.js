// backend/controllers/ultramsg.js
const axios = require('axios');

async function sendWhatsAppMessage({ instanceId, token, to, body }) {
  if (!instanceId || !token) throw new Error('UltraMsg not configured');
  const url = `https://api.ultramsg.com/${instanceId}/messages/chat`;
  const payload = { token, to, body };
  const res = await axios.post(url, payload, { headers: { 'Content-Type':'application/json' }, timeout:15000 });
  return res.data;
}

module.exports = { sendWhatsAppMessage };
