// Interest & loan calculation engine
export function computeLoan(loan, repayments = [], asOfDate = new Date()) {
  const principal = Number(loan.principal) || 0;
  const rate = (Number(loan.interest_rate) || 0) / 100;
  const loanDate = new Date(loan.loan_date);
  const now = new Date(asOfDate);
  const days = Math.max(0, Math.floor((now - loanDate) / (1000 * 60 * 60 * 24)));
  const years = days / 365;

  const totalPaid = repayments.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  let interest = 0;
  if (loan.interest_type === 'simple') {
    interest = principal * rate * years;
  } else if (loan.interest_type === 'compound') {
    const nMap = { daily: 365, weekly: 52, monthly: 12, quarterly: 4, yearly: 1 };
    const n = nMap[loan.interest_frequency] || 12;
    interest = principal * (Math.pow(1 + rate / n, n * years) - 1);
  }

  const totalDue = principal + interest;
  const outstanding = Math.max(0, totalDue - totalPaid);

  // Status calc
  let status = loan.status || 'active';
  if (outstanding <= 0.01) status = 'completed';
  else if (loan.due_date) {
    const due = new Date(loan.due_date);
    const diffDays = Math.floor((due - now) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) status = 'overdue';
    else if (diffDays <= 7) status = 'due_soon';
    else status = 'active';
  }

  return {
    principal,
    interest: Math.round(interest * 100) / 100,
    total_due: Math.round(totalDue * 100) / 100,
    total_paid: Math.round(totalPaid * 100) / 100,
    outstanding: Math.round(outstanding * 100) / 100,
    days_elapsed: days,
    status,
  };
}

export function computeCreditScore(loans = []) {
  // Score 0-100 based on payment history
  if (loans.length === 0) return { score: 75, label: 'New' };
  let score = 100;
  let overdueCount = 0;
  let completedOnTime = 0;
  for (const l of loans) {
    if (l.computed?.status === 'overdue') { score -= 15; overdueCount++; }
    if (l.computed?.status === 'completed') completedOnTime++;
  }
  score = Math.max(0, Math.min(100, score));
  const label = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Average' : 'Poor';
  return { score, label, overdue_count: overdueCount, completed: completedOnTime };
}
