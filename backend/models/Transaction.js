const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  friend: { type: mongoose.Schema.Types.ObjectId, ref: 'Friend', required: true },

  // FIXED: Do NOT default everything to "loan"
  type: {
    type: String,
    enum: ['credit', 'debit', 'loan', 'repay'],
    default: 'debit'   // safer default for savings manager
  },

  amount: { type: Number, required: true },

  // Optional reason (mainly used for loan manager)
  reason: { type: String, default: '' },

  note: { type: String },

  date: { type: Date, default: Date.now },

  previousBalance: { type: Number, default: null },
  newBalance: { type: Number, default: null }

}, { timestamps: true });

module.exports = mongoose.model('Transaction', TransactionSchema);
