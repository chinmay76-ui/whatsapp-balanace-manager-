const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  friend: { type: mongoose.Schema.Types.ObjectId, ref: 'Friend', required: true },

  // NEW: Type of transaction – safe addition
  // Existing data stays valid because type is optional.
  type: {
    type: String,
    enum: ['credit', 'debit', 'loan', 'repay'],
    default: 'loan' // only applies when you create new loans
  },

  amount: { type: Number, required: true },

  // NEW: Detailed reason for loan (optional)
  reason: { type: String, default: '' },

  // Existing note (untouched)
  note: { type: String },

  // Existing date (untouched)
  date: { type: Date, default: Date.now },

  // NEW: For tracking before/after balances – optional & safe
  previousBalance: { type: Number, default: null },
  newBalance: { type: Number, default: null }

}, { timestamps: true });

module.exports = mongoose.model('Transaction', TransactionSchema);
