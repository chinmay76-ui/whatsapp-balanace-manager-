// backend/routes/loans.js
const express = require('express');
const router = express.Router();
const Loan = require('../models/Transaction'); // using transaction model for loans
const Friend = require('../models/Friend');
const { sendWhatsAppMessage } = require('../controllers/ultramsg');
const { buildExactLoanReminder } = require('../utils/buildExactLoanReminder');

const INSTANCE_ID = process.env.ULTRAMSG_INSTANCE;
const TOKEN = process.env.ULTRAMSG_TOKEN;

/**
 * Helper: recalc owedAmount for a friend from transactions
 */
async function recalcOwed(friendId) {
  const ag = await Loan.aggregate([
    { $match: { friend: friendId, type: { $in: ['loan','repay'] } } },
    { $group: {
        _id: "$friend",
        loanSum: { $sum: { $cond: [{ $eq: ["$type","loan"] }, "$amount", 0] } },
        repaySum: { $sum: { $cond: [{ $eq: ["$type","repay"] }, "$amount", 0] } }
    }}
  ]);
  const total = (ag[0] ? (ag[0].loanSum - ag[0].repaySum) : 0);
  await Friend.findByIdAndUpdate(friendId, { owedAmount: total, lastUpdatedAt: new Date() });
  return total;
}

/**
 * Create a loan entry:
 * POST /api/loans
 */
router.post('/', async (req, res) => {
  try {
    const { friendId, amount, reason = '', sendMessage = false } = req.body;
    if (!friendId || !amount || Number(amount) <= 0) return res.status(400).json({ error:'Invalid payload' });

    const friend = await Friend.findById(friendId);
    if (!friend) return res.status(404).json({ error:'Friend not found' });

    const prev = Number(friend.owedAmount || 0);
    const newBal = prev + Number(amount);

    const loan = await Loan.create({
      friend: friend._id,
      type: 'loan',
      amount,
      reason,
      previousBalance: prev,
      newBalance: newBal
    });

    await recalcOwed(friend._id);

    let sendResult = null;
    if (sendMessage) {
      if (!INSTANCE_ID || !TOKEN) {
        // Do not throw, return info to client
        return res.status(503).json({ error: 'UltraMsg not configured' });
      }
      const message = buildExactLoanReminder({
        name: friend.name,
        amount,
        borrowedDate: loan.createdAt,
        reason
      });
      try {
        sendResult = await sendWhatsAppMessage({ instanceId: INSTANCE_ID, token: TOKEN, to: friend.whatsapp, body: message });
      } catch (err) {
        console.error('UltraMsg send error (create loan):', err && (err.stack || err));
        // Return created loan but include send error
        const refreshedFriend = await Friend.findById(friend._id);
        return res.status(201).json({ loan, friend: refreshedFriend, sendResult: { success: false, error: String(err.message || err) }});
      }
    }

    const refreshedFriend = await Friend.findById(friend._id);
    res.status(201).json({ loan, friend: refreshedFriend, sendResult });
  } catch (err) {
    console.error('POST /api/loans error:', err && (err.stack || err));
    res.status(500).json({ error:'Failed to create loan' });
  }
});

/**
 * Patch loan
 */
router.patch('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const loan = await Loan.findById(id);
    if (!loan) return res.status(404).json({ error:'Loan not found' });

    if (req.body.amount !== undefined) {
      const newAmount = Number(req.body.amount);
      if (isNaN(newAmount) || newAmount < 0) return res.status(400).json({ error:'Invalid amount' });
      loan.amount = newAmount;
    } else if (req.body.increment !== undefined) {
      const inc = Number(req.body.increment);
      if (isNaN(inc)) return res.status(400).json({ error:'Invalid increment' });
      loan.amount = loan.amount + inc;
    }
    if (req.body.reason !== undefined) loan.reason = req.body.reason;
    await loan.save();
    await recalcOwed(loan.friend);
    const friend = await Friend.findById(loan.friend);
    res.json({ loan, friend });
  } catch (err) {
    console.error('PATCH /api/loans/:id error:', err && (err.stack || err));
    res.status(500).json({ error:'Failed to update loan' });
  }
});

/**
 * Delete loan
 */
router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const loan = await Loan.findById(id);
    if (!loan) return res.status(404).json({ error:'Loan not found' });
    const friendId = loan.friend;
    await loan.deleteOne();
    await recalcOwed(friendId);
    const friend = await Friend.findById(friendId);
    res.json({ message:'Loan deleted', friend });
  } catch (err) {
    console.error('DELETE /api/loans/:id error:', err && (err.stack || err));
    res.status(500).json({ error:'Failed to delete loan' });
  }
});

/**
 * Get loans for a friend
 */
router.get('/friend/:friendId', async (req, res) => {
  try {
    const friend = await Friend.findById(req.params.friendId);
    if (!friend) return res.status(404).json({ error:'Friend not found' });
    const txs = await Loan.find({ friend: friend._id, type: { $in:['loan','repay'] } }).sort({ createdAt:-1 });
    res.json({ friend, owedAmount: friend.owedAmount || 0, txs });
  } catch (err) {
    console.error('GET /api/loans/friend/:friendId error:', err && (err.stack || err));
    res.status(500).json({ error:'Failed to fetch loans' });
  }
});

/**
 * Overview
 */
router.get('/overview', async (req, res) => {
  try {
    const friends = await Friend.find().select('name owedAmount whatsapp').sort({ name:1 });
    const overall = friends.reduce((acc,f) => acc + (Number(f.owedAmount || 0)), 0);
    res.json({ friends, overall });
  } catch (err) {
    console.error('GET /api/loans/overview error:', err && (err.stack || err));
    res.status(500).json({ error:'Failed to fetch overview' });
  }
});

/**
 * Notify for a single loan entry (exact message)
 * POST /api/loans/:id/notify
 */
router.post('/:id/notify', async (req, res) => {
  try {
    const id = req.params.id;
    const loan = await Loan.findById(id).populate('friend');
    if (!loan) return res.status(404).json({ error:'Loan not found' });

    const friend = loan.friend;
    if (!friend) return res.status(404).json({ error:'Friend not found' });

    if (!INSTANCE_ID || !TOKEN) {
      // UltraMsg not set — return 503 so frontend knows sending is unavailable
      return res.status(503).json({ error: 'UltraMsg not configured' });
    }

    const message = buildExactLoanReminder({
      name: friend.name,
      amount: loan.amount,
      borrowedDate: loan.createdAt,
      reason: loan.reason
    });

    try {
      const sendResult = await sendWhatsAppMessage({ instanceId: INSTANCE_ID, token: TOKEN, to: friend.whatsapp, body: message });
      return res.json({ ok:true, sendResult });
    } catch (err) {
      console.error('POST /api/loans/:id/notify UltraMsg error:', err && (err.stack || err));
      // Return 502 (bad gateway) with provider detail
      return res.status(502).json({ error:'Failed to send message', detail: String(err.message || err) });
    }
  } catch (err) {
    console.error('POST /api/loans/:id/notify error:', err && (err.stack || err));
    res.status(500).json({ error:'Failed to send notify' });
  }
});

/**
 * Friend-level notify (summary)
 * POST /api/loans/friend/:friendId/notify
 */
router.post('/friend/:friendId/notify', async (req, res) => {
  try {
    const friend = await Friend.findById(req.params.friendId);
    if (!friend) return res.status(404).json({ error:'Friend not found' });

    if (!INSTANCE_ID || !TOKEN) {
      return res.status(503).json({ error: 'UltraMsg not configured' });
    }

    // Build the short summary message format you requested
    const message = `🔔 *Reminder: Please return*\n\nHi ${friend.name},\nThis is a reminder for the borrowed amount:\n\n💸 Amount: ₹${friend.owedAmount}\n🗓 Borrowed on: ${new Date().toLocaleString('en-IN', { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' })}\n📝 Reason: —\n\nPlease return at your earliest convenience. 🙏\n\n— Savings Manager`;

    try {
      const sendResult = await sendWhatsAppMessage({ instanceId: INSTANCE_ID, token: TOKEN, to: friend.whatsapp, body: message });
      return res.json({ ok:true, sendResult });
    } catch (err) {
      console.error('POST /api/loans/friend/:friendId/notify UltraMsg error:', err && (err.stack || err));
      return res.status(502).json({ error:'Failed to send message', detail: String(err.message || err) });
    }
  } catch (err) {
    console.error('POST /api/loans/friend/:friendId/notify error:', err && (err.stack || err));
    res.status(500).json({ error:'Failed to send friend notify' });
  }
});

module.exports = router;
