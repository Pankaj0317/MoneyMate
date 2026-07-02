import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { MongoClient } from 'mongodb';
import { GoogleGenAI, Type } from '@google/genai';
import { Resend } from 'resend';
import { v4 as uuidv4 } from 'uuid';
import { computeLoan, computeCreditScore } from '@/lib/finance';

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

const INSIGHT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    insights: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          insight: { type: Type.STRING },
          type: { type: Type.STRING, enum: ['warning', 'positive', 'neutral', 'action'] },
          icon: { type: Type.STRING, enum: ['trend', 'alert', 'money', 'savings', 'loan'] },
        },
        required: ['title', 'insight', 'type', 'icon'],
      },
    },
  },
  required: ['insights'],
};

async function callLLMInsights(context) {
  const prompt = `You are an expert personal finance analyst for a digital ledger app. Analyze this user's financial data and produce 5-7 sharp, specific, actionable insights. Each insight must be 1-2 sentences with concrete numbers and useful advice. Cover diverse angles: overdue loans, interest earning trends, spending patterns, savings ratio, borrower behavior, cash flow.\n\nData:\n${JSON.stringify(context)}`;

  const response = await genai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: INSIGHT_SCHEMA,
      temperature: 0.4,
    },
  });

  const parsed = JSON.parse(response.text);
  return parsed.insights || [];
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

// ---------- AUTH HELPERS ----------
async function getUserFromReq() {
  const store = await cookies();
  const token = store.get('session_token')?.value;
  if (!token) return null;
  const db = await getDb();
  const session = await db.collection('sessions').findOne({ token });
  if (!session) return null;
  if (session.expires_at && new Date(session.expires_at) < new Date()) return null;
  const user = await db.collection('users').findOne({ id: session.user_id }, { projection: { _id: 0 } });
  return user;
}

const PUBLIC_ROUTES = ['health', 'auth'];

// ---------- BULK REPAYMENT ALLOCATION ----------
function allocateBulk(amount, loans, strategy, manualAllocations) {
  if (strategy === 'manual' && Array.isArray(manualAllocations)) {
    return manualAllocations
      .filter(a => Number(a.amount) > 0)
      .map(a => {
        const loan = loans.find(l => l.id === a.loan_id);
        const cap = loan?.computed?.outstanding || 0;
        return { loan_id: a.loan_id, amount: Math.round(Math.min(Number(a.amount), cap) * 100) / 100 };
      });
  }

  let sorted = [...loans];
  if (strategy === 'oldest') sorted.sort((a, b) => new Date(a.loan_date) - new Date(b.loan_date));
  else if (strategy === 'newest') sorted.sort((a, b) => new Date(b.loan_date) - new Date(a.loan_date));
  else if (strategy === 'highest_interest') sorted.sort((a, b) => (Number(b.interest_rate) || 0) - (Number(a.interest_rate) || 0));
  else if (strategy === 'proportional') {
    const total = sorted.reduce((s, l) => s + l.computed.outstanding, 0);
    if (total <= 0) return [];
    const raw = sorted.map(l => ({ loan_id: l.id, amount: Math.round((l.computed.outstanding / total) * amount * 100) / 100 }));
    const allocated = raw.reduce((s, a) => s + a.amount, 0);
    if (raw.length > 0 && Math.abs(amount - allocated) > 0.001) {
      raw[0].amount = Math.round((raw[0].amount + (amount - allocated)) * 100) / 100;
    }
    return raw;
  }

  let remaining = amount;
  const out = [];
  for (const l of sorted) {
    if (remaining <= 0.01) break;
    const alloc = Math.min(remaining, l.computed.outstanding);
    if (alloc > 0.01) {
      out.push({ loan_id: l.id, amount: Math.round(alloc * 100) / 100 });
      remaining -= alloc;
    }
  }
  return out;
}

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

  // ---------- AUTH ----------
  if (path[0] === 'auth') {
    // POST /api/auth/session — exchange Emergent session_id for user + set cookie
    if (path[1] === 'session' && method === 'POST') {
      const { session_id } = body;
      if (!session_id) return json({ error: 'session_id required' }, 400);
      try {
        const r = await fetch('https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data', {
          headers: { 'X-Session-ID': session_id },
        });
        if (!r.ok) return json({ error: 'Invalid session' }, 401);
        const data = await r.json();
        // Upsert user
        const userId = data.id || data.user_id || uuidv4();
        const user = {
          id: userId,
          email: data.email,
          name: data.name || data.email?.split('@')[0] || 'User',
          picture: data.picture || null,
          last_login: new Date().toISOString(),
        };
        await db.collection('users').updateOne({ id: userId }, { $set: user, $setOnInsert: { created_at: new Date().toISOString() } }, { upsert: true });
        // Create session
        const token = data.session_token || uuidv4();
        const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.collection('sessions').insertOne({ token, user_id: userId, expires_at: expires.toISOString(), created_at: new Date().toISOString() });
        // Set cookie
        const store = await cookies();
        store.set('session_token', token, {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
          expires,
        });
        return json({ success: true, user });
      } catch (e) {
        console.error('Auth exchange error', e);
        return json({ error: e.message }, 500);
      }
    }
    // GET /api/auth/me
    if (path[1] === 'me' && method === 'GET') {
      const user = await getUserFromReq();
      if (!user) return json({ user: null });
      return json({ user });
    }
    // POST /api/auth/logout
    if (path[1] === 'logout' && method === 'POST') {
      const store = await cookies();
      const token = store.get('session_token')?.value;
      if (token) await db.collection('sessions').deleteOne({ token });
      store.set('session_token', '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
      return json({ success: true });
    }
    return json({ error: 'auth route not found' }, 404);
  }

  // ---------- AUTH GUARD FOR ALL OTHER ROUTES ----------
  const currentUser = await getUserFromReq();
  if (!currentUser) return json({ error: 'unauthorized' }, 401);
  const uid = currentUser.id;

  // ---------- BORROWERS ----------
  if (path[0] === 'borrowers') {
    if (path.length === 1 && method === 'GET') {
      const list = await db.collection('borrowers').find({ user_id: uid }, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray();
      // enrich w/ loan summary
      const enriched = [];
      for (const b of list) {
        const loans = await db.collection('loans').find({ user_id: uid, borrower_id: b.id }, { projection: { _id: 0 } }).toArray();
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
      const doc = { id: uuidv4(), user_id: uid, name: body.name, phone: body.phone || '', email: body.email || '', address: body.address || '', tags: body.tags || [], notes: body.notes || '', created_at: new Date().toISOString() };
      await db.collection('borrowers').insertOne(doc);
      await logActivity(db, { user_id: uid, type: 'borrower_created', ref_id: doc.id, message: `Added contact ${doc.name}` });
      return json({ ...doc, _id: undefined }, 201);
    }
    if (path.length === 2 && method === 'GET') {
      const b = await db.collection('borrowers').findOne({ id: path[1], user_id: uid }, { projection: { _id: 0 } });
      if (!b) return json({ error: 'Not found' }, 404);
      const loans = await db.collection('loans').find({ user_id: uid, borrower_id: b.id }, { projection: { _id: 0 } }).toArray();
      const enrichedLoans = [];
      for (const l of loans) enrichedLoans.push(await enrichLoan(db, l));
      const credit = computeCreditScore(enrichedLoans);
      // timeline
      const timeline = await db.collection('activity_logs').find({ user_id: uid, $or: [{ ref_id: b.id }, { borrower_id: b.id }] }).sort({ created_at: -1 }).toArray();
      return json({ ...b, loans: enrichedLoans, credit_score: credit, timeline: timeline.map(t => ({ ...t, _id: undefined })) });
    }
    if (path.length === 2 && method === 'PUT') {
      await db.collection('borrowers').updateOne({ id: path[1], user_id: uid }, { $set: body });
      return json({ ok: true });
    }
    if (path.length === 2 && method === 'DELETE') {
      await db.collection('borrowers').deleteOne({ id: path[1], user_id: uid });
      return json({ ok: true });
    }
    // Bulk repayment: POST /api/borrowers/:id/bulk-repayment  (body.preview=true for preview only)
    if (path.length === 3 && path[2] === 'bulk-repayment' && method === 'POST') {
      const borrowerId = path[1];
      const borrower = await db.collection('borrowers').findOne({ id: borrowerId, user_id: uid });
      if (!borrower) return json({ error: 'Borrower not found' }, 404);

      const amount = Number(body.amount);
      if (!amount || amount <= 0) return json({ error: 'Amount must be greater than 0' }, 400);

      const strategy = body.strategy || 'oldest';
      const preview = !!body.preview;
      const loanType = body.loan_type || 'given';
      const selectedLoanIds = Array.isArray(body.selected_loan_ids) && body.selected_loan_ids.length ? body.selected_loan_ids : null;

      // Gather outstanding loans for this borrower
      const rawLoans = await db.collection('loans').find({ user_id: uid, borrower_id: borrowerId, type: loanType }, { projection: { _id: 0 } }).toArray();
      const loans = [];
      for (const l of rawLoans) {
        const reps = await db.collection('repayments').find({ loan_id: l.id }).toArray();
        const computed = computeLoan(l, reps);
        if (computed.outstanding > 0.01) loans.push({ ...l, computed });
      }
      const eligibleLoans = selectedLoanIds ? loans.filter(l => selectedLoanIds.includes(l.id)) : loans;
      if (eligibleLoans.length === 0) return json({ error: 'No outstanding loans for this contact' }, 400);

      const allocations = allocateBulk(amount, eligibleLoans, strategy, body.manual_allocations);
      const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0);
      const unallocated = Math.max(0, Math.round((amount - totalAllocated) * 100) / 100);

      // Build enriched preview with loan info
      const enrichedAllocations = allocations.map(a => {
        const loan = eligibleLoans.find(l => l.id === a.loan_id);
        return {
          ...a,
          loan_principal: loan?.principal,
          loan_outstanding_before: loan?.computed?.outstanding,
          loan_outstanding_after: Math.max(0, Math.round((loan?.computed?.outstanding - a.amount) * 100) / 100),
          loan_date: loan?.loan_date,
          loan_interest_rate: loan?.interest_rate,
          fully_settled: loan ? (loan.computed.outstanding - a.amount) <= 0.01 : false,
        };
      });

      if (preview) {
        return json({
          borrower: { id: borrower.id, name: borrower.name },
          amount,
          strategy,
          currency: eligibleLoans[0]?.currency || 'INR',
          allocations: enrichedAllocations,
          total_allocated: Math.round(totalAllocated * 100) / 100,
          unallocated,
          eligible_loans: eligibleLoans.map(l => ({ id: l.id, principal: l.principal, outstanding: l.computed.outstanding, loan_date: l.loan_date, interest_rate: l.interest_rate, days_elapsed: l.computed.days_elapsed, currency: l.currency })),
        });
      }

      // Persist repayments
      const bulkId = uuidv4();
      const methodType = body.method || 'cash';
      const date = body.date || new Date().toISOString();
      const notes = body.notes || '';
      const created = [];
      for (const alloc of allocations) {
        if (alloc.amount <= 0) continue;
        const rep = {
          id: uuidv4(),
          user_id: uid,
          loan_id: alloc.loan_id,
          amount: alloc.amount,
          method: methodType,
          date,
          notes: notes ? `[Bulk] ${notes}` : `[Bulk payment ${bulkId.slice(0, 8)}]`,
          bulk_payment_id: bulkId,
          created_at: new Date().toISOString(),
        };
        await db.collection('repayments').insertOne(rep);
        created.push({ ...rep, _id: undefined });
      }
      // Store bulk record for audit
      await db.collection('bulk_payments').insertOne({
        id: bulkId,
        user_id: uid,
        borrower_id: borrowerId,
        amount,
        method: methodType,
        date,
        notes,
        strategy,
        allocations: enrichedAllocations,
        unallocated,
        created_at: new Date().toISOString(),
      });
      await logActivity(db, {
        user_id: uid,
        type: 'bulk_payment_received',
        ref_id: bulkId,
        borrower_id: borrowerId,
        message: `Bulk payment of ${eligibleLoans[0]?.currency || 'INR'} ${amount} from ${borrower.name} split across ${created.length} loan(s)${unallocated > 0 ? ` (${unallocated} unallocated)` : ''}`,
      });
      return json({ success: true, bulk_payment_id: bulkId, allocations: created, count: created.length, unallocated }, 201);
    }
  }

  // ---------- LOANS ----------
  if (path[0] === 'loans') {
    if (path.length === 1 && method === 'GET') {
      const filter = { user_id: uid };
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
        user_id: uid,
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
      const borrower = await db.collection('borrowers').findOne({ id: doc.borrower_id, user_id: uid });
      await logActivity(db, {
        user_id: uid,
        type: 'loan_created',
        ref_id: doc.id,
        borrower_id: doc.borrower_id,
        message: `${doc.type === 'given' ? 'Lent' : 'Borrowed'} ${doc.currency} ${doc.principal} ${doc.type === 'given' ? 'to' : 'from'} ${borrower?.name || 'contact'}`,
      });
      return json(await enrichLoan(db, doc), 201);
    }
    if (path.length === 2 && method === 'GET') {
      const l = await db.collection('loans').findOne({ id: path[1], user_id: uid }, { projection: { _id: 0 } });
      if (!l) return json({ error: 'Not found' }, 404);
      return json(await enrichLoan(db, l));
    }
    if (path.length === 2 && method === 'DELETE') {
      await db.collection('loans').deleteOne({ id: path[1], user_id: uid });
      await db.collection('repayments').deleteMany({ loan_id: path[1] });
      return json({ ok: true });
    }
    // Repayments: /api/loans/:id/repayments
    if (path.length === 3 && path[2] === 'repayments' && method === 'POST') {
      const loan = await db.collection('loans').findOne({ id: path[1], user_id: uid });
      if (!loan) return json({ error: 'Loan not found' }, 404);
      const rep = {
        id: uuidv4(),
        user_id: uid,
        loan_id: path[1],
        amount: Number(body.amount) || 0,
        method: body.method || 'cash',
        date: body.date || new Date().toISOString(),
        notes: body.notes || '',
        created_at: new Date().toISOString(),
      };
      await db.collection('repayments').insertOne(rep);
      const borrower = await db.collection('borrowers').findOne({ id: loan.borrower_id, user_id: uid });
      await logActivity(db, {
        user_id: uid,
        type: 'payment_received',
        ref_id: loan.id,
        borrower_id: loan.borrower_id,
        message: `Payment of ${loan.currency} ${rep.amount} recorded${borrower ? ` from ${borrower.name}` : ''}`,
      });
      return json({ ...rep, _id: undefined }, 201);
    }
    // Reminder: /api/loans/:id/reminder — POST { to?: string }
    if (path.length === 3 && path[2] === 'reminder' && method === 'POST') {
      const loan = await db.collection('loans').findOne({ id: path[1], user_id: uid });
      if (!loan) return json({ error: 'Loan not found' }, 404);
      const borrower = await db.collection('borrowers').findOne({ id: loan.borrower_id, user_id: uid });
      const toEmail = body.to || borrower?.email;
      if (!toEmail) return json({ error: 'No email on contact. Add one first or provide "to".' }, 400);
      const reps = await db.collection('repayments').find({ loan_id: loan.id }).toArray();
      const computed = computeLoan(loan, reps);
      const symbol = { INR: '\u20b9', USD: '$', EUR: '\u20ac', GBP: '\u00a3', AED: 'AED ' }[loan.currency] || '';
      const dueStr = loan.due_date ? new Date(loan.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : 'Not set';
      const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f8fafc;margin:0;padding:32px 16px;">
<table style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.06);overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,#8b5cf6,#d946ef);padding:32px 28px;color:#fff;">
<div style="font-size:12px;letter-spacing:2px;opacity:.85;">LEDGR \u2022 PAYMENT REMINDER</div>
<div style="font-size:26px;font-weight:700;margin-top:8px;">Hi ${borrower?.name || 'there'},</div>
<div style="opacity:.9;margin-top:6px;">A quick reminder about your outstanding balance.</div></td></tr>
<tr><td style="padding:28px;">
<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:20px;">
<div style="font-size:12px;color:#991b1b;text-transform:uppercase;letter-spacing:1px;">Outstanding</div>
<div style="font-size:34px;font-weight:800;color:#b91c1c;margin-top:4px;">${symbol}${computed.outstanding.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
<div style="font-size:13px;color:#7f1d1d;margin-top:4px;">of ${symbol}${computed.total_due.toLocaleString('en-IN', { maximumFractionDigits: 2 })} total due</div></div>
<table style="width:100%;margin-top:20px;border-collapse:collapse;">
<tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:13px;">Principal</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;">${symbol}${loan.principal.toLocaleString('en-IN')}</td></tr>
<tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:13px;">Interest accrued</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;color:#059669;">${symbol}${computed.interest.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td></tr>
<tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:13px;">Already paid</td><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;">${symbol}${computed.total_paid.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td></tr>
<tr><td style="padding:10px 0;color:#64748b;font-size:13px;">Due date</td><td style="padding:10px 0;text-align:right;font-weight:600;">${dueStr}</td></tr></table>
<div style="margin-top:24px;padding:16px;background:#f8fafc;border-radius:10px;font-size:13px;color:#475569;line-height:1.6;">
${loan.notes ? `<div style="margin-bottom:8px;"><strong>Note:</strong> ${loan.notes}</div>` : ''}
Please settle at your earliest convenience. Reply to this email if you have any questions.</div>
<div style="margin-top:28px;text-align:center;color:#94a3b8;font-size:12px;">Sent via Ledgr \u2014 Smart Expense & Loan Manager</div>
</td></tr></table></body></html>`;

      try {
        const result = await resend.emails.send({
          from: 'Ledgr <onboarding@resend.dev>',
          to: [toEmail],
          subject: `Payment reminder \u2014 ${symbol}${computed.outstanding.toLocaleString('en-IN', { maximumFractionDigits: 2 })} outstanding${loan.due_date ? ` (due ${dueStr})` : ''}`,
          html,
        });
        if (result.error) throw new Error(result.error.message || JSON.stringify(result.error));
        await logActivity(db, {
          user_id: uid,
          type: 'reminder_sent',
          ref_id: loan.id,
          borrower_id: loan.borrower_id,
          message: `Reminder email sent to ${toEmail}`,
        });
        return json({ success: true, to: toEmail, id: result.data?.id });
      } catch (e) {
        console.error('resend error', e);
        return json({ error: e.message || 'Failed to send email' }, 500);
      }
    }
  }

  // ---------- ACTIVITY LOGS ----------
  if (path[0] === 'activity' && method === 'GET') {
    const limit = Math.min(parseInt(q.limit || '200'), 500);
    const typeFilter = q.type;
    const filter = { user_id: uid };
    if (typeFilter && typeFilter !== 'all') filter.type = typeFilter;
    const logs = await db.collection('activity_logs').find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(limit).toArray();
    // Enrich with borrower name
    const borrowerIds = [...new Set(logs.map(l => l.borrower_id).filter(Boolean))];
    const borrowers = borrowerIds.length ? await db.collection('borrowers').find({ id: { $in: borrowerIds }, user_id: uid }).toArray() : [];
    const bMap = Object.fromEntries(borrowers.map(b => [b.id, b.name]));
    return json({
      logs: logs.map(l => ({ ...l, borrower_name: l.borrower_id ? bMap[l.borrower_id] : null })),
      total: logs.length,
    });
  }

  // ---------- EXPENSES ----------
  if (path[0] === 'expenses') {
    if (path.length === 1 && method === 'GET') {
      const list = await db.collection('expenses').find({ user_id: uid }, { projection: { _id: 0 } }).sort({ date: -1 }).toArray();
      return json(list);
    }
    if (path.length === 1 && method === 'POST') {
      const doc = {
        id: uuidv4(),
        user_id: uid,
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
      await db.collection('expenses').deleteOne({ id: path[1], user_id: uid });
      return json({ ok: true });
    }
  }

  // ---------- INCOME ----------
  if (path[0] === 'income') {
    if (path.length === 1 && method === 'GET') {
      const list = await db.collection('income').find({ user_id: uid }, { projection: { _id: 0 } }).sort({ date: -1 }).toArray();
      return json(list);
    }
    if (path.length === 1 && method === 'POST') {
      const doc = {
        id: uuidv4(),
        user_id: uid,
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
      await db.collection('income').deleteOne({ id: path[1], user_id: uid });
      return json({ ok: true });
    }
  }

  // ---------- CALENDAR ----------
  if (path[0] === 'calendar' && method === 'GET') {
    const loans = await db.collection('loans').find({ user_id: uid, due_date: { $ne: null } }, { projection: { _id: 0 } }).toArray();
    const expenses = await db.collection('expenses').find({ user_id: uid }, { projection: { _id: 0 } }).toArray();
    const income = await db.collection('income').find({ user_id: uid }, { projection: { _id: 0 } }).toArray();
    const repayments = await db.collection('repayments').find({ user_id: uid }, { projection: { _id: 0 } }).toArray();
    const enrichedLoans = [];
    for (const l of loans) enrichedLoans.push(await enrichLoan(db, l));
    return json({ loan_due_dates: enrichedLoans, expenses, income, repayments });
  }

  // ---------- DASHBOARD ----------
  if (path[0] === 'dashboard' && method === 'GET') {
    const loans = await db.collection('loans').find({ user_id: uid }, { projection: { _id: 0 } }).toArray();
    const enrichedLoans = [];
    for (const l of loans) enrichedLoans.push(await enrichLoan(db, l));
    const expenses = await db.collection('expenses').find({ user_id: uid }, { projection: { _id: 0 } }).toArray();
    const income = await db.collection('income').find({ user_id: uid }, { projection: { _id: 0 } }).toArray();

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
      const loans = await db.collection('loans').find({ user_id: uid }, { projection: { _id: 0 } }).toArray();
      const enrichedLoans = [];
      for (const l of loans) enrichedLoans.push(await enrichLoan(db, l));
      const expenses = await db.collection('expenses').find({ user_id: uid }, { projection: { _id: 0 } }).toArray();
      const income = await db.collection('income').find({ user_id: uid }, { projection: { _id: 0 } }).toArray();
      const borrowers = await db.collection('borrowers').find({ user_id: uid }, { projection: { _id: 0 } }).toArray();

      const context = {
        loans_summary: enrichedLoans.map(l => ({ borrower: l.borrower?.name, type: l.type, principal: l.principal, outstanding: l.computed.outstanding, status: l.computed.status, due_date: l.due_date, days_elapsed: l.computed.days_elapsed, interest_type: l.interest_type, interest_rate: l.interest_rate })),
        expenses_by_category: expenses.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + e.amount; return acc; }, {}),
        recent_expenses: expenses.slice(0, 20),
        income_summary: income.reduce((acc, i) => { acc[i.category] = (acc[i.category] || 0) + i.amount; return acc; }, {}),
        borrower_count: borrowers.length,
      };

      const prompt_context = context;
      const insights = await callLLMInsights(prompt_context);
      return json({ insights, generated_at: new Date().toISOString(), model: 'gemini-2.5-flash' });
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
