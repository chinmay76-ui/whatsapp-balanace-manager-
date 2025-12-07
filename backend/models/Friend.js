// backend/models/Friend.js
const mongoose = require('mongoose');

const FriendSchema = new mongoose.Schema({
  name: { type: String, required: true },
  whatsapp: { type: String, required: true },
  // `savedAmount` is the fixed amount the friend originally saved (or manual fixed value)
  savedAmount: { type: Number, default: 0 },
  // `totalBalance` is the current available balance (decreases on debits)
  totalBalance: { type: Number, default: 0 },
  // NEW: total amount this friend currently owes you (loans/borrowed money)
  owedAmount: { type: Number, default: 0 },
  lastUpdatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Friend', FriendSchema);
