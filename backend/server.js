// backend/server.js (updated)
// Improvements included:
// - Use helmet + compression for performance & security
// - Use express.json() instead of body-parser
// - Respect CLIENT_URL env var for CORS (supports comma-separated list)
// - Add /_health endpoint for Render health checks
// - Add timing middleware to log request durations
// - Send UltraMsg in background (fire-and-forget) to avoid blocking responses
// - Better logging and safe handling of missing env vars

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const axios = require('axios');

const Friend = require('./models/Friend');
const Transaction = require('./models/Transaction');
const loansRouter = require('./routes/loans');

const app = express();

// Security & performance
app.use(helmet());
app.use(compression());

// Body parser
app.use(express.json());

// CORS: respect CLIENT_URL env var; allow comma-separated list
const clientUrlRaw = process.env.CLIENT_URL && String(process.env.CLIENT_URL).trim();
let corsOptions = {};
if (clientUrlRaw) {
  const allowed = clientUrlRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length === 1) {
    corsOptions = { origin: allowed[0] };
  } else if (allowed.length > 1) {
    corsOptions = { origin: function(origin, callback) {
      // allow requests with no origin (like curl, mobile apps)
      if (!origin) return callback(null, true);
      if (allowed.indexOf(origin) !== -1) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    } };
  }
} else {
  // default permissive during development; set CLIENT_URL in production
  corsOptions = { origin: '*' };
}
app.use(cors(corsOptions));

// Request timing middleware for logs
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms`);
  });
  next();
});

// Mount routers
app.use('/api/loans', loansRouter);

// Health check (Render: set Health Check Path to /_health)
app.get('/_health', (req, res) => {
  // Optionally check DB state
  const readyState = mongoose.connection.readyState; // 1 = connected
  res.json({ status: 'ok', time: Date.now(), mongoState: readyState });
});

// Basic root
app.get('/', (req, res) => res.json({ ok: true }));

// Env
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const ULTRA_INSTANCE = process.env.ULTRAMSG_INSTANCE;
const ULTRA_TOKEN = process.env.ULTRAMSG_TOKEN;

if (!MONGO_URI) {
  console.error('MONGO_URI missing in environment - please set your MongoDB connection string.');
  process.exit(1);
}

if (!ULTRA_INSTANCE || !ULTRA_TOKEN) {
  console.warn('Warning: ULTRAMSG_INSTANCE or ULTRAMSG_TOKEN missing. WhatsApp sends will be skipped until configured.');
}
console.log('CLIENT_URL =', clientUrlRaw || 'NOT SET (allowing all origins)');
console.log('ULTRA INSTANCE =', ULTRA_INSTANCE || 'NOT SET');
console.log('ULTRA TOKEN =', !!ULTRA_TOKEN ? '***REDACTED***' : 'NOT SET');

// ----------------------
// MongoDB connection
// ----------------------
mongoose.connect(MONGO_URI, {
  // explicit pool settings help under load
  maxPoolSize: 50,
  serverSelectionTimeoutMS: 5000
})
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

async function sendUltraMsgOnce(to, bodyText) {
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

// fire-and-forget wrapper — logs result but does not block the request
function sendUltraMsgFireAndForget(to, bodyText) {
  // run asynchronously without awaiting to the caller
  (async () => {
    try {
      const r = await sendUltraMsgOnce(to, bodyText);
      console.log('UltraMsg background send result:', r && r.success ? 'ok' : r.error || 'failed');
    } catch (err) {
      console.error('UltraMsg background send unexpected error:', err);
    }
  })();
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
// Routes (friends, transactions)
// ----------------------

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

    const tx = new Transaction({ friend: friend._id, amount: amt, note });
    await tx.save();

    friend.totalBalance = previousBalance - amt;
    friend.lastUpdatedAt = tx.date || new Date();
    await friend.save();

    const todaySpent = await todaysSpent(friend._id);

    const messageText = [
      `📅 *Date:* ${new Date(tx.date).toLocaleString()}`,
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

    // send in background so request returns fast
    sendUltraMsgFireAndForget(friend.whatsapp, messageText);

    res.json({ success: true, friend, transaction: tx });
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

    const tx = new Transaction({ friend: friend._id, amount: amt, note });
    await tx.save();

    friend.totalBalance = previousBalance - amt;
    friend.lastUpdatedAt = tx.date || new Date();
    await friend.save();

    const txDateStr = new Date(tx.date).toLocaleString();
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
      `🤖 *This is an automated message — please don't reply.*`
    ].join('\n');

    // Send asynchronously to avoid delaying response
    sendUltraMsgFireAndForget(friend.whatsapp, messageText);

    res.json({ success: true, friend, transaction: tx });
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
    // For test-send we *do* await so user sees result
    const result = await sendUltraMsgOnce(to, body);
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

// Mount last (already mounted loans above)

app.listen(PORT, () => console.log(`Server listening on ${PORT} (CLIENT_URL=${clientUrlRaw || 'NOT SET'})`));
