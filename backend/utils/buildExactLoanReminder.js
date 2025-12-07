// backend/utils/buildExactLoanReminder.js
function formatDateForReminder(d) {
  const opts = { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' };
  return new Date(d).toLocaleString('en-IN', opts);
}

function buildExactLoanReminder({ name, amount, borrowedDate, reason }) {
  const bDate = formatDateForReminder(borrowedDate || new Date());
  const r = (reason && String(reason).trim()) ? String(reason).trim() : '—';
  return `🔔 *Reminder: Please return*\n\nHi ${name},\nThis is a reminder for the borrowed amount:\n\n💸 Amount: ₹${amount}\n🗓 Borrowed on: ${bDate}\n📝 Reason: ${r}\n\nPlease return at your earliest convenience. 🙏\n\n— Savings Manager`;
}

module.exports = { buildExactLoanReminder };
