import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { computeLoan, computeCreditScore } from '@/lib/finance';

async function callLLM(prompt) {
  const res = await fetch('https://integrations.emergentagent.com/llm/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.EMERGENT_LLM_KEY}`,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LLM ${res.status}: ${t}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

const uri = process.env.MONGO_URL;
const dbName = process.env.DB_NAME || 'finance_manager';

let clientPromise;
if (!global._mongoClientPromise) {
  const client = new MongoClient(uri);
  global._mongoClientPromise = client.connect();
}
clientPromise = global._mongoClientPromise;

async function getDb() {
  const c = await clientPromise;
  return c.db(dbName);
}

const anthropic = null; // deprecated, using direct fetch via callLLM

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

async function logActivity(db, entry) {
  await db.collection('activity_logs').insertOne({
    id: uuidv4(),
    ...entry,
    created_at: new Date().toISOString(),
  });
}

async function enrichLoan(db, loan) {
  const reps = await db.collection('repayments').find({ loan_id: loan.id }).toArray();
  const computed = computeLoan(loan, reps);
  const borrower = loan.borrower_id
    ? await db.collection('borrowers').findOne({ id: loan.borrower_id }, { projection: { _id: 0 } })
    : null;
  return { ...loan, _id: undefined, computed, repayments: reps.map(r => ({ ...r, _id: undefined })), borrower };
}

async function handleRoute(req, method, path) {
  const db = await getDb();
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await req.json().catch(() => ({})) : {};
  const url = new URL(req.url);
  const q = Object.fromEntries(url.searchParams.entries());

  // Health
  if (path.length === 0 || path[0] === 'health') return json({ ok: true });

  // ---------- BORROWERS ----------
  if (path[0] === 'borrowers') {
    if (path.length === 1 && method === 'GET') {
      const list = await db.collection('borrowers').find({}, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray();
      // enrich w/ loan summary
      const enriched = [];
      for (const b of list) {
        const loans = await db.collection('loans').find({ borrower_id: b.id }, { projection: { _id: 0 } }).toArray();
        const enrichedLoans = [];
        for (const l of loans) {
          const reps = await db.collection('repayments').find({ loan_id: l.id }).toArray();
          enrichedLoans.push({ ...l, computed: computeLoan(l, reps) });
        }
        const outstanding = enrichedLoans.reduce((s, l) => s + (l.computed.outstanding || 0), 0);
        const totalLent = enrichedLoans.filter(l => l.type === 'given').reduce((s, l) => s + l.principal, 0);
        const totalBorrowed = enrichedLoans.filter(l => l.type === 'taken').reduce((s, l) => s + l.principal, 0);
        const credit = computeCreditScore(enrichedLoans);
        enriched.push({ ...b, outstanding, total_lent: totalLent, total_borrowed: totalBorrowed, active_loans: enrichedLoans.filter(l => l.computed.outstanding > 0).length, credit_score: credit });
      }
      return json(enriched);
    }
    if (path.length === 1 && method === 'POST') {
      const doc = { id: uuidv4(), name: body.name, phone: body.phone || '', email: body.email || '', address: body.address || '', tags: body.tags || [], notes: body.notes || '', created_at: new Date().toISOString() };
      await db.collection('borrowers').insertOne(doc);
      await logActivity(db, { type: 'borrower_created', ref_id: doc.id, message: `Added contact ${doc.name}` });
      return json({ ...doc, _id: undefined }, 201);
    }
    if (path.length === 2 && method === 'GET') {
      const b = await db.collection('borrowers').findOne({ id: path[1] }, { projection: { _id: 0 } });
      if (!b) return json({ error: 'Not found' }, 404);
      const loans = await db.collection('loans').find({ borrower_id: b.id }, { projection: { _id: 0 } }).toArray();
      const enrichedLoans = [];
      for (const l of loans) enrichedLoans.push(await enrichLoan(db, l));
      const credit = computeCreditScore(enrichedLoans);
      // timeline
      const timeline = await db.collection('activity_logs').find({ $or: [{ ref_id: b.id }, { borrower_id: b.id }] }).sort({ created_at: -1 }).toArray();
      return json({ ...b, loans: enrichedLoans, credit_score: credit, timeline: timeline.map(t => ({ ...t, _id: undefined })) });
    }
    if (path.length === 2 && method === 'PUT') {
      await db.collection('borrowers').updateOne({ id: path[1] }, { $set: body });
      return json({ ok: true });
    }
    if (path.length === 2 && method === 'DELETE') {
      await db.collection('borrowers').deleteOne({ id: path[1] });
      return json({ ok: true });
    }
  }

  // ---------- LOANS ----------
  if (path[0] === 'loans') {
    if (path.length === 1 && method === 'GET') {
      const filter = {};
      if (q.type) filter.type = q.type;
      if (q.borrower_id) filter.borrower_id = q.borrower_id;
      const loans = await db.collection('loans').find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray();
      const enriched = [];
      for (const l of loans) enriched.push(await enrichLoan(db, l));
      return json(enriched);
    }
    if (path.length === 1 && method === 'POST') {
      const doc = {
        id: uuidv4(),
        borrower_id: body.borrower_id,
        type: body.type || 'given',
        principal: Number(body.principal) || 0,
        currency: body.currency || 'INR',
        loan_date: body.loan_date || new Date().toISOString(),
        due_date: body.due_date || null,
        interest_type: body.interest_type || 'none',
        interest_rate: Number(body.interest_rate) || 0,
        interest_frequency: body.interest_frequency || 'monthly',
        notes: body.notes || '',
        status: 'active',
        created_at: new Date().toISOString(),
      };
      await db.collection('loans').insertOne(doc);
      const borrower = await db.collection('borrowers').findOne({ id: doc.borrower_id });
      await logActivity(db, {
        type: 'loan_created',
        ref_id: doc.id,
        borrower_id: doc.borrower_id,
        message: `${doc.type === 'given' ? 'Lent' : 'Borrowed'} ${doc.currency} ${doc.principal} ${doc.type === 'given' ? 'to' : 'from'} ${borrower?.name || 'contact'}`,
      });
      return json(await enrichLoan(db, doc), 201);
    }
    if (path.length === 2 && method === 'GET') {
      const l = await db.collection('loans').findOne({ id: path[1] }, { projection: { _id: 0 } });
      if (!l) return json({ error: 'Not found' }, 404);
      return json(await enrichLoan(db, l));
    }
    if (path.length === 2 && method === 'DELETE') {
      await db.collection('loans').deleteOne({ id: path[1] });
      await db.collection('repayments').deleteMany({ loan_id: path[1] });
      return json({ ok: true });
    }
    // Repayments: /api/loans/:id/repayments
    if (path.length === 3 && path[2] === 'repayments' && method === 'POST') {
      const loan = await db.collection('loans').findOne({ id: path[1] });
      if (!loan) return json({ error: 'Loan not found' }, 404);
      const rep = {
        id: uuidv4(),
        loan_id: path[1],
        amount: Number(body.amount) || 0,
        method: body.method || 'cash',
        date: body.date || new Date().toISOString(),
        notes: body.notes || '',
        created_at: new Date().toISOString(),
      };
      await db.collection('repayments').insertOne(rep);
      const borrower = await db.collection('borrowers').findOne({ id: loan.borrower_id });
      await logActivity(db, {
        type: 'payment_received',
        ref_id: loan.id,
        borrower_id: loan.borrower_id,
        message: `Payment of ${loan.currency} ${rep.amount} recorded${borrower ? ` from ${borrower.name}` : ''}`,
      });
      return json({ ...rep, _id: undefined }, 201);
    }
  }

  // ---------- EXPENSES ----------
  if (path[0] === 'expenses') {
    if (path.length === 1 && method === 'GET') {
      const list = await db.collection('expenses').find({}, { projection: { _id: 0 } }).sort({ date: -1 }).toArray();
      return json(list);
    }
    if (path.length === 1 && method === 'POST') {
      const doc = {
        id: uuidv4(),
        category: body.category || 'Others',
        amount: Number(body.amount) || 0,
        date: body.date || new Date().toISOString(),
        notes: body.notes || '',
        method: body.method || 'cash',
        tags: body.tags || [],
        created_at: new Date().toISOString(),
      };
      await db.collection('expenses').insertOne(doc);
      return json({ ...doc, _id: undefined }, 201);
    }
    if (path.length === 2 && method === 'DELETE') {
      await db.collection('expenses').deleteOne({ id: path[1] });
      return json({ ok: true });
    }
  }

  // ---------- INCOME ----------
  if (path[0] === 'income') {
    if (path.length === 1 && method === 'GET') {
      const list = await db.collection('income').find({}, { projection: { _id: 0 } }).sort({ date: -1 }).toArray();
      return json(list);
    }
    if (path.length === 1 && method === 'POST') {
      const doc = {
        id: uuidv4(),
        category: body.category || 'Salary',
        amount: Number(body.amount) || 0,
        date: body.date || new Date().toISOString(),
        source: body.source || '',
        notes: body.notes || '',
        created_at: new Date().toISOString(),
      };
      await db.collection('income').insertOne(doc);
      return json({ ...doc, _id: undefined }, 201);
    }
    if (path.length === 2 && method === 'DELETE') {
      await db.collection('income').deleteOne({ id: path[1] });
      return json({ ok: true });
    }
  }

  // ---------- DASHBOARD ----------
  if (path[0] === 'dashboard' && method === 'GET') {
    const loans = await db.collection('loans').find({}, { projection: { _id: 0 } }).toArray();
    const enrichedLoans = [];
    for (const l of loans) enrichedLoans.push(await enrichLoan(db, l));
    const expenses = await db.collection('expenses').find({}, { projection: { _id: 0 } }).toArray();
    const income = await db.collection('income').find({}, { projection: { _id: 0 } }).toArray();

    const totalLent = enrichedLoans.filter(l => l.type === 'given').reduce((s, l) => s + l.principal, 0);
    const totalBorrowed = enrichedLoans.filter(l => l.type === 'taken').reduce((s, l) => s + l.principal, 0);
    const outstandingLent = enrichedLoans.filter(l => l.type === 'given').reduce((s, l) => s + l.computed.outstanding, 0);
    const outstandingBorrowed = enrichedLoans.filter(l => l.type === 'taken').reduce((s, l) => s + l.computed.outstanding, 0);
    const totalInterestEarned = enrichedLoans.filter(l => l.type === 'given').reduce((s, l) => s + l.computed.interest, 0);
    const totalReturned = enrichedLoans.reduce((s, l) => s + l.computed.total_paid, 0);
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const totalIncome = income.reduce((s, i) => s + i.amount, 0);

    const now = new Date();
    const overdue = enrichedLoans.filter(l => l.computed.status === 'overdue');
    const dueSoon = enrichedLoans.filter(l => l.computed.status === 'due_soon');
    const activeLoans = enrichedLoans.filter(l => l.computed.outstanding > 0);

    // Monthly chart data (last 6 months)
    const monthlyData = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const label = d.toLocaleString('en-US', { month: 'short' });
      const monthLent = enrichedLoans.filter(l => l.type === 'given' && new Date(l.loan_date) >= d && new Date(l.loan_date) < end).reduce((s, l) => s + l.principal, 0);
      const monthExpenses = expenses.filter(e => new Date(e.date) >= d && new Date(e.date) < end).reduce((s, e) => s + e.amount, 0);
      const monthIncome = income.filter(i => new Date(i.date) >= d && new Date(i.date) < end).reduce((s, i) => s + i.amount, 0);
      monthlyData.push({ month: label, lent: monthLent, expenses: monthExpenses, income: monthIncome, savings: monthIncome - monthExpenses });
    }

    // Expense category breakdown
    const catMap = {};
    for (const e of expenses) catMap[e.category] = (catMap[e.category] || 0) + e.amount;
    const expenseCategories = Object.entries(catMap).map(([name, value]) => ({ name, value }));

    return json({
      totals: {
        total_lent: totalLent,
        total_borrowed: totalBorrowed,
        outstanding_lent: outstandingLent,
        outstanding_borrowed: outstandingBorrowed,
        total_returned: totalReturned,
        total_interest_earned: totalInterestEarned,
        total_expenses: totalExpenses,
        total_income: totalIncome,
        monthly_savings: totalIncome - totalExpenses,
        net_position: totalIncome - totalExpenses + outstandingLent - outstandingBorrowed,
        active_loans_count: activeLoans.length,
        overdue_count: overdue.length,
        due_soon_count: dueSoon.length,
      },
      monthly_data: monthlyData,
      expense_categories: expenseCategories,
      overdue_loans: overdue,
      due_soon_loans: dueSoon,
      recent_loans: enrichedLoans.slice(0, 5),
    });
  }

  // ---------- AI INSIGHTS ----------
  if (path[0] === 'ai' && path[1] === 'insights' && method === 'POST') {
    try {
      // Gather full context
      const loans = await db.collection('loans').find({}, { projection: { _id: 0 } }).toArray();
      const enrichedLoans = [];
      for (const l of loans) enrichedLoans.push(await enrichLoan(db, l));
      const expenses = await db.collection('expenses').find({}, { projection: { _id: 0 } }).toArray();
      const income = await db.collection('income').find({}, { projection: { _id: 0 } }).toArray();
      const borrowers = await db.collection('borrowers').find({}, { projection: { _id: 0 } }).toArray();

      const context = {
        loans_summary: enrichedLoans.map(l => ({ borrower: l.borrower?.name, type: l.type, principal: l.principal, outstanding: l.computed.outstanding, status: l.computed.status, due_date: l.due_date, days_elapsed: l.computed.days_elapsed, interest_type: l.interest_type, interest_rate: l.interest_rate })),
        expenses_by_category: expenses.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + e.amount; return acc; }, {}),
        recent_expenses: expenses.slice(0, 20),
        income_summary: income.reduce((acc, i) => { acc[i.category] = (acc[i.category] || 0) + i.amount; return acc; }, {}),
        borrower_count: borrowers.length,
      };

      const prompt = `You are an expert personal finance analyst. Analyze this user's financial data and provide 5-7 sharp, actionable insights. Each insight must be short (1-2 sentences), specific with numbers, and useful. Format as JSON array with objects: {"title": "...", "insight": "...", "type": "warning|positive|neutral|action", "icon": "trend|alert|money|savings|loan"}.

Data: ${JSON.stringify(context)}

Respond ONLY with valid JSON array, nothing else.`;

      const raw = await callLLM(prompt);
      let text = (raw || '').trim();
      // strip markdown code fences if present
      text = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
      let insights = [];
      try { insights = JSON.parse(text); } catch (e) {
        insights = [{ title: 'Insight', insight: text, type: 'neutral', icon: 'trend' }];
      }
      return json({ insights, generated_at: new Date().toISOString() });
    } catch (e) {
      console.error('AI error', e);
      return json({ error: e.message || 'AI failed' }, 500);
    }
  }

  return json({ error: 'Not found', path, method }, 404);
}

export async function GET(req, props) { const p = await props.params; return handleRoute(req, 'GET', p?.path || []); }
export async function POST(req, props) { const p = await props.params; return handleRoute(req, 'POST', p?.path || []); }
export async function PUT(req, props) { const p = await props.params; return handleRoute(req, 'PUT', p?.path || []); }
export async function PATCH(req, props) { const p = await props.params; return handleRoute(req, 'PATCH', p?.path || []); }
export async function DELETE(req, props) { const p = await props.params; return handleRoute(req, 'DELETE', p?.path || []); }
