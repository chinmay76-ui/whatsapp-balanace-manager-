// backend/server.js (timezone fix: display dates in Asia/Kolkata)
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');

const Friend = require('./models/Friend');
const Transaction = require('./models/Transaction');
const loansRouter = require('./routes/loans');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// mount loans router
app.use('/api/loans', loansRouter);

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const ULTRA_INSTANCE = process.env.ULTRAMSG_INSTANCE;
const ULTRA_TOKEN = process.env.ULTRAMSG_TOKEN;

if (!MONGO_URI) {
  console.error('MONGO_URI missing in .env - please set your MongoDB connection string.');
  process.exit(1);
}

if (!ULTRA_INSTANCE || !ULTRA_TOKEN) {
  console.warn('Warning: ULTRAMSG_INSTANCE or ULTRAMSG_TOKEN missing. WhatsApp sends will be skipped until configured.');
}
console.log("ULTRA INSTANCE =", ULTRA_INSTANCE || 'NOT SET');
console.log("ULTRA TOKEN =", !!ULTRA_TOKEN ? '***REDACTED***' : 'NOT SET');

// ----------------------
// MongoDB connection
// ----------------------
// NOTE: Do not pass legacy mongoose options here (mongoose v6/v7 handle defaults).
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ----------------------
// UltraMsg helper
// ----------------------
function normalizePhone(to) {
  if (!to) return '';
  return String(to).replace(/\D/g, ''); // digits-only, e.g. 919812345678
}

async function sendUltraMsg(to, bodyText) {
  if (!ULTRA_INSTANCE || !ULTRA_TOKEN) {
    console.warn('⚠️ UltraMsg not configured — skipping send.');
    return { success: false, error: 'ultramsg_not_configured' };
  }

  const phone = normalizePhone(to);
  if (!phone) {
    console.warn('sendUltraMsg: invalid phone', to);
    return { success: false, error: 'invalid_phone' };
  }

  const url = `https://api.ultramsg.com/${ULTRA_INSTANCE}/messages/chat`;
  const payload = {
    token: ULTRA_TOKEN,
    to: phone,
    body: bodyText
  };

  try {
    const resp = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
    return { success: true, data: resp.data };
  } catch (err) {
    const detail = err.response?.data || err.message || String(err);
    console.error('UltraMsg send error detail:', detail);
    return { success: false, error: detail };
  }
}

// ----------------------
// Utility: today's spent
// ----------------------
async function todaysSpent(friendId) {
  const start = new Date(); start.setHours(0,0,0,0);
  const end = new Date(); end.setHours(23,59,59,999);
  const txs = await Transaction.find({ friend: friendId, date: { $gte: start, $lte: end }});
  return txs.reduce((s, t) => s + (Number(t.amount) || 0), 0);
}

// ----------------------
// Routes
// ----------------------

// Health
app.get('/', (req, res) => res.json({ ok: true }));

// Create friend
app.post('/api/friends', async (req, res) => {
  try {
    const { name, whatsapp, totalBalance, savedAmount } = req.body;
    if (!name || !whatsapp) return res.status(400).json({ error: 'name and whatsapp required' });

    const initSaved = (savedAmount !== undefined && savedAmount !== null)
      ? Number(savedAmount)
      : (Number(totalBalance) || 0);

    const friend = new Friend({
      name,
      whatsapp,
      savedAmount: initSaved,
      totalBalance: Number(totalBalance) || initSaved || 0
    });

    await friend.save();
    res.json(friend);
  } catch (err) {
    console.error('POST /api/friends error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List friends
app.get('/api/friends', async (req, res) => {
  try {
    const friends = await Friend.find().sort({ createdAt: -1 });
    res.json(friends);
  } catch (err) {
    console.error('GET /api/friends error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update friend's savedAmount (fixed saved value)
app.patch('/api/friends/:id/saved', async (req, res) => {
  try {
    const { id } = req.params;
    const { savedAmount } = req.body;
    if (savedAmount === undefined || savedAmount === null) return res.status(400).json({ error: 'savedAmount required' });

    const friend = await Friend.findById(id);
    if (!friend) return res.status(404).json({ error: 'Friend not found' });

    friend.savedAmount = Number(savedAmount);
    await friend.save();
    res.json({ success: true, friend });
  } catch (err) {
    console.error('PATCH /api/friends/:id/saved error:', err);
    res.status(500).json({ error: err.message });
  }
});

// compatibility route: POST /api/friends/:friendId/deduct
app.post('/api/friends/:friendId/deduct', async (req, res) => {
  try {
    const { friendId } = req.params;
    const { amount, note } = req.body;
    const amt = Number(amount);
    if (Number.isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'amount must be a positive number' });

    const friend = await Friend.findById(friendId);
    if (!friend) return res.status(404).json({ error: 'Friend not found' });

    const previousBalance = Number(friend.totalBalance || 0);

    // create a debit transaction (explicit)
    const tx = new Transaction({ friend: friend._id, type: 'debit', amount: amt, note });
    await tx.save();

    friend.totalBalance = previousBalance - amt;
    friend.lastUpdatedAt = tx.date || new Date();
    await friend.save();

    const todaySpent = await todaysSpent(friend._id);

    // SERVER-SIDE TIMEZONE: format tx.date in Asia/Kolkata
    const txDateStr = new Date(tx.date).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    const messageText = [
      `📅 *Date:* ${txDateStr}`,
      `👤 Name: ${friend.name}`,
      ``,
      `💰 *Fixed Saved Amount:* ₹${friend.savedAmount}`,
      `💸 Debited: ₹${amt}`,
      `💳 Previous Balance: ₹${previousBalance}`,
      `🧾 Today's Total Spent: ₹${todaySpent}`,
      `📉 *Available Balance:* ₹${friend.totalBalance}`,
      ``,
      `📝 *Note:* ${note || '—'}`,
      ``,
      `🤖 *Automated message — Savings Manager*`
    ].join('\n');

    const sendResult = await sendUltraMsg(friend.whatsapp, messageText);

    res.json({ success: true, friend, transaction: tx, sent: sendResult });
  } catch (err) {
    console.error('POST /api/friends/:friendId/deduct error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Send money route: creates transaction, updates balance, sends UltraMsg WhatsApp
app.post('/api/send/:friendId', async (req, res) => {
  try {
    const { friendId } = req.params;
    const { amount, note } = req.body;

    const amt = Number(amount);
    if (Number.isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'amount must be a positive number' });

    const friend = await Friend.findById(friendId);
    if (!friend) return res.status(404).json({ error: 'Friend not found' });

    const previousBalance = Number(friend.totalBalance || 0);

    // create a debit transaction (explicit)
    const tx = new Transaction({ friend: friend._id, type: 'debit', amount: amt, note });
    await tx.save();

    friend.totalBalance = previousBalance - amt;
    friend.lastUpdatedAt = tx.date || new Date();
    await friend.save();

    const txDateStr = new Date(tx.date).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    const fixedSaved = Number(friend.savedAmount || 0);
    const todaySpent = await todaysSpent(friend._id);

    const userNote = note && note.trim() !== "" ? note : "—";

    const messageText = [
      `📅 *Date:* ${txDateStr}`,
      `👤 Name: ${friend.name}`,
      ``,
      `💰 *Fixed Saved Amount*: ₹${fixedSaved}`,
      `💸 Debited: ₹${amt}`,
      `💳 Previous Balance: ₹${previousBalance}`,
      `🧾 Today's Total Spent: ₹${todaySpent}`,
      `📉 *Available Balance:* ₹${friend.totalBalance}`,
      ``,
      `📝 *Note:* ${userNote}`,
      ``,
      `🤖 *This is an automated message by Chinmay — please don't reply.*`
    ].join('\n');

    const sendResult = await sendUltraMsg(friend.whatsapp, messageText);
    console.log('UltraMsg sendResult:', sendResult);

    res.json({
      success: true,
      friend,
      transaction: tx,
      sent: sendResult
    });
  } catch (err) {
    console.error('POST /api/send/:friendId error:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Manual balance update
app.patch('/api/friends/:id/balance', async (req, res) => {
  try {
    const { id } = req.params;
    const { totalBalance } = req.body;
    const friend = await Friend.findById(id);
    if (!friend) return res.status(404).json({ error: 'Friend not found' });

    friend.totalBalance = Number(totalBalance);
    friend.lastUpdatedAt = new Date();
    await friend.save();

    res.json({ success: true, friend });
  } catch (err) {
    console.error('PATCH /api/friends/:id/balance error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Transaction history for friend
app.get('/api/friends/:id/transactions', async (req, res) => {
  try {
    const { id } = req.params;
    const txs = await Transaction.find({ friend: id }).sort({ date: -1 });
    res.json(txs);
  } catch (err) {
    console.error('GET /api/friends/:id/transactions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Quick test-send endpoint (no DB)
app.post('/api/test-send', async (req, res) => {
  try {
    const { to, body } = req.body;
    if (!to || !body) return res.status(400).json({ error: 'to and body required' });
    const result = await sendUltraMsg(to, body);
    res.json(result);
  } catch (err) {
    console.error('POST /api/test-send error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete friend + all their transactions
app.delete('/api/friends/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const friend = await Friend.findById(id);
    if (!friend) return res.status(404).json({ error: "Friend not found" });

    await Transaction.deleteMany({ friend: id });
    await Friend.findByIdAndDelete(id);

    res.json({ success: true, message: "Friend deleted successfully" });
  } catch (err) {
    console.error("DELETE /api/friends/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
