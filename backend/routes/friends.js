// in backend/routes/friends.js (append or merge these handlers)
const express = require('express');
const router = express.Router();
const Friend = require('../models/Friend');
const Transaction = require('../models/Transaction');
const { sendWhatsAppMessage } = require('../controllers/ultramsg');

const INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;
const FROM_NUMBER = process.env.FROM_NUMBER || ''; // optional

// 1) Record a loan (someone took money)
router.post('/:id/loan', async (req, res) => {
  try {
    const friend = await Friend.findById(req.params.id);
    if (!friend) return res.status(404).json({ error: 'Friend not found' });

    const amount = Number(req.body.amount);
    if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const note = req.body.note || 'Loan recorded';

    const prevOwed = Number(friend.owedAmount || 0);
    const newOwed = prevOwed + amount;

    const tx = await Transaction.create({
      friend: friend._id,
      type: 'loan',
      amount,
      previousBalance: prevOwed,
      newBalance: newOwed,
      note
    });

    friend.owedAmount = newOwed;
    friend.lastUpdatedAt = new Date();
    await friend.save();

    // if front-end requested immediate message send, handle it
    if (req.body.sendMessage === true && INSTANCE_ID && TOKEN) {
      // prepare message
      const message = buildLoanMessage({
        date: new Date(),
        name: friend.name,
        amount,
        prevOwed,
        newOwed,
        note
      });
      try {
        await sendWhatsAppMessage({
          instanceId: INSTANCE_ID,
          token: TOKEN,
          to: friend.whatsapp,
          body: message
        });
      } catch (err) {
        // log error but still return success (loan recorded)
        console.error('UltraMsg send error:', err);
      }
    }

    res.status(201).json({ tx, friend });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record loan' });
  }
});

// 2) Repayment: friend returns money (reduces owedAmount)
router.post('/:id/repay', async (req, res) => {
  try {
    const friend = await Friend.findById(req.params.id);
    if (!friend) return res.status(404).json({ error: 'Friend not found' });

    const amount = Number(req.body.amount);
    if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const prevOwed = Number(friend.owedAmount || 0);
    const newOwed = prevOwed - amount;
    if (newOwed < 0) return res.status(400).json({ error: 'Repay amount greater than owed' });

    const note = req.body.note || 'Repayment';

    const tx = await Transaction.create({
      friend: friend._id,
      type: 'repay',
      amount,
      previousBalance: prevOwed,
      newBalance: newOwed,
      note
    });

    friend.owedAmount = newOwed;
    friend.lastUpdatedAt = new Date();
    await friend.save();

    // optional: if you also want to credit the returned money to totalBalance, you can:
    // friend.totalBalance += amount; await friend.save();

    res.json({ tx, friend });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record repayment' });
  }
});

// 3) Notify friend to return money (no DB change)
router.post('/:id/notify-return', async (req, res) => {
  try {
    const friend = await Friend.findById(req.params.id);
    if (!friend) return res.status(404).json({ error: 'Friend not found' });

    const amount = Number(friend.owedAmount || 0);
    if (amount <= 0) return res.status(400).json({ error: 'No owed amount to notify' });

    const note = req.body.note || '';

    const message = buildReturnNotification({
      date: new Date(),
      name: friend.name,
      owed: amount,
      note
    });

    if (!INSTANCE_ID || !TOKEN) {
      return res.status(500).json({ error: 'UltraMsg not configured on server' });
    }

    const sendResult = await sendWhatsAppMessage({
      instanceId: INSTANCE_ID,
      token: TOKEN,
      to: friend.whatsapp,
      body: message
    });

    res.json({ ok: true, sendResult });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send notify message' });
  }
});

// 4) Get owed summary and transactions
router.get('/:id/owed', async (req, res) => {
  try {
    const friend = await Friend.findById(req.params.id);
    if (!friend) return res.status(404).json({ error: 'Friend not found' });

    const owedAmount = Number(friend.owedAmount || 0);
    const loanTxs = await Transaction.find({ friend: friend._id, type: { $in: ['loan','repay'] } }).sort({ createdAt: -1 });

    res.json({ owedAmount, loanTxs, friend });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch owed summary' });
  }
});

/* Helper message builders (local to this file, adjust footer as needed) */

function formatDateShort(d) {
  return d.toLocaleString('en-IN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' });
}

function buildLoanMessage({ date, name, amount, prevOwed, newOwed, note }) {
  // emojis and nice format
  return `📢 *Loan Recorded*\n\n🗓 Date: ${formatDateShort(date)}\n👤 Name: ${name}\n💸 Borrowed: ₹${amount}\n📉 Previous Owed: ₹${prevOwed}\n📈 New Owed: ₹${newOwed}\n\n📝 Note: ${note || '—'}\n\nPlease keep this in mind. 🙏\n\n— Automated message from Savings Manager`;
}

function buildReturnNotification({ date, name, owed, note }) {
  return `🔔 *Friendly Reminder*\n\nHi ${name},\nYou currently owe ₹${owed} (as of ${formatDateShort(date)}).\n\n${note ? `📝 Note: ${note}\n\n` : ''}Please return the amount when convenient. 🙏\n\nThanks!\n— Automated reminder from Savings Manager`;
}

module.exports = router;
