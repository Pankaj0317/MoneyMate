'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { toast } from 'sonner';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, Legend, AreaChart, Area
} from 'recharts';
import {
  Wallet, TrendingUp, TrendingDown, Users, ArrowUpRight, ArrowDownLeft, PlusCircle, Sparkles,
  Receipt, DollarSign, AlertTriangle, CheckCircle2, Clock, Trash2, Calendar, IndianRupee,
  ChevronRight, Zap, Brain, Target, Bell, BadgeCheck, BadgeAlert, Search
} from 'lucide-react';

const CURRENCIES = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ' };
const COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ef4444', '#10b981', '#ec4899', '#6366f1', '#84cc16'];
const EXPENSE_CATS = ['Food', 'Shopping', 'Travel', 'Fuel', 'Medical', 'Bills', 'Rent', 'Entertainment', 'Education', 'Investment', 'Others'];
const INCOME_CATS = ['Salary', 'Freelancing', 'Business', 'Interest Income', 'Rental Income', 'Investments', 'Other'];

function fmt(n, cur = 'INR') {
  const num = Number(n) || 0;
  return `${CURRENCIES[cur] || ''}${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function api(path, opts = {}) {
  return fetch(`/api/${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  }).then(r => r.json());
}

const StatCard = ({ icon: Icon, label, value, sub, gradient, trend }) => (
  <Card className="relative overflow-hidden border-0 shadow-md hover:shadow-lg transition-shadow">
    <div className={`absolute inset-0 opacity-90 ${gradient}`} />
    <CardContent className="relative p-5 text-white">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-white/80">{label}</div>
          <div className="mt-2 text-2xl font-bold">{value}</div>
          {sub && <div className="mt-1 text-xs text-white/80">{sub}</div>}
        </div>
        <div className="rounded-lg bg-white/20 p-2 backdrop-blur"><Icon className="h-5 w-5" /></div>
      </div>
      {trend && (
        <div className="mt-3 text-xs text-white/90 flex items-center gap-1"><TrendingUp className="h-3 w-3" />{trend}</div>
      )}
    </CardContent>
  </Card>
);

function Sidebar({ tab, setTab }) {
  const nav = [
    { id: 'dashboard', label: 'Dashboard', icon: Zap },
    { id: 'loans', label: 'Loans', icon: Wallet },
    { id: 'borrowers', label: 'Contacts', icon: Users },
    { id: 'expenses', label: 'Expenses', icon: Receipt },
    { id: 'income', label: 'Income', icon: DollarSign },
    { id: 'ai', label: 'AI Insights', icon: Sparkles },
  ];
  return (
    <aside className="hidden md:flex w-60 flex-col border-r bg-gradient-to-b from-slate-50 to-white p-4">
      <div className="flex items-center gap-2 px-2 py-3">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center text-white font-bold shadow-md">L</div>
        <div>
          <div className="font-bold text-slate-900">Ledgr</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">AI Finance</div>
        </div>
      </div>
      <nav className="mt-6 flex flex-col gap-1">
        {nav.map(n => (
          <button key={n.id} onClick={() => setTab(n.id)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${tab === n.id ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>
            <n.icon className="h-4 w-4" />{n.label}
          </button>
        ))}
      </nav>
      <div className="mt-auto rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 p-4 text-white">
        <Brain className="h-5 w-5 mb-2" />
        <div className="font-semibold text-sm">AI-Powered Insights</div>
        <div className="text-xs text-white/80 mt-1">Claude Sonnet 4.5 analyzes your data.</div>
      </div>
    </aside>
  );
}

function Dashboard({ data, currency, onOpenLoan }) {
  if (!data) return <div className="p-8 text-center text-slate-500">Loading dashboard...</div>;
  const t = data.totals;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Welcome back 👋</h1>
        <p className="text-slate-500 text-sm mt-1">Here's a snapshot of your money — lent, borrowed, and spent.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={ArrowUpRight} label="Total Lent" value={fmt(t.total_lent, currency)} sub={`Outstanding ${fmt(t.outstanding_lent, currency)}`} gradient="bg-gradient-to-br from-violet-600 to-fuchsia-600" />
        <StatCard icon={ArrowDownLeft} label="Total Borrowed" value={fmt(t.total_borrowed, currency)} sub={`Outstanding ${fmt(t.outstanding_borrowed, currency)}`} gradient="bg-gradient-to-br from-rose-500 to-orange-500" />
        <StatCard icon={TrendingUp} label="Interest Earned" value={fmt(t.total_interest_earned, currency)} sub={`${t.active_loans_count} active loans`} gradient="bg-gradient-to-br from-emerald-500 to-teal-600" />
        <StatCard icon={Wallet} label="Net Position" value={fmt(t.net_position, currency)} sub={`Savings: ${fmt(t.monthly_savings, currency)}`} gradient="bg-gradient-to-br from-indigo-500 to-blue-600" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-11 w-11 rounded-lg bg-red-50 flex items-center justify-center"><AlertTriangle className="h-5 w-5 text-red-500" /></div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{t.overdue_count}</div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Overdue Loans</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-11 w-11 rounded-lg bg-amber-50 flex items-center justify-center"><Clock className="h-5 w-5 text-amber-500" /></div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{t.due_soon_count}</div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Due This Week</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-11 w-11 rounded-lg bg-emerald-50 flex items-center justify-center"><CheckCircle2 className="h-5 w-5 text-emerald-500" /></div>
            <div>
              <div className="text-2xl font-bold text-slate-900">{fmt(t.total_returned, currency)}</div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Total Returned</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Cash Flow — Last 6 months</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.monthly_data}>
                <defs>
                  <linearGradient id="inc" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.5} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                  <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.5} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <RTooltip />
                <Legend />
                <Area type="monotone" dataKey="income" stroke="#10b981" fill="url(#inc)" strokeWidth={2} />
                <Area type="monotone" dataKey="expenses" stroke="#ef4444" fill="url(#exp)" strokeWidth={2} />
                <Line type="monotone" dataKey="lent" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Expenses by Category</CardTitle></CardHeader>
          <CardContent>
            {data.expense_categories.length === 0 ? (
              <div className="text-center text-slate-400 text-sm py-16">Add expenses to see breakdown</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={data.expense_categories} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={3}>
                    {data.expense_categories.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <RTooltip formatter={(v) => fmt(v, currency)} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {data.overdue_loans.length > 0 && (
        <Card className="border-red-200 bg-red-50/30">
          <CardHeader><CardTitle className="flex items-center gap-2 text-red-700"><AlertTriangle className="h-5 w-5" />Overdue Loans</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.overdue_loans.map(l => (
              <div key={l.id} onClick={() => onOpenLoan(l)} className="flex items-center justify-between p-3 bg-white rounded-lg cursor-pointer hover:shadow">
                <div>
                  <div className="font-medium text-sm">{l.borrower?.name || 'Unknown'}</div>
                  <div className="text-xs text-slate-500">Due {l.due_date ? new Date(l.due_date).toLocaleDateString() : '—'}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-red-600">{fmt(l.computed.outstanding, l.currency)}</div>
                  <div className="text-xs text-slate-500">outstanding</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LoansView({ loans, borrowers, currency, onRefresh, onOpenLoan }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: 'given', principal: '', currency, interest_type: 'none', interest_rate: '', interest_frequency: 'monthly', loan_date: new Date().toISOString().slice(0, 10), due_date: '', notes: '', borrower_id: '' });

  async function submit() {
    if (!form.borrower_id || !form.principal) { toast.error('Select contact and enter amount'); return; }
    const r = await api('loans', { method: 'POST', body: JSON.stringify(form) });
    if (r.id) { toast.success('Loan created'); setOpen(false); onRefresh(); }
    else toast.error(r.error || 'Failed');
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Loans</h1>
          <p className="text-sm text-slate-500 mt-1">Track money you've lent or borrowed — interest calculated automatically.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:opacity-90"><PlusCircle className="h-4 w-4 mr-2" />New Loan</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Loan</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Contact</Label>
                <Select value={form.borrower_id} onValueChange={v => setForm({ ...form, borrower_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select contact" /></SelectTrigger>
                  <SelectContent>{borrowers.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Type</Label>
                <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="given">Money Lent</SelectItem><SelectItem value="taken">Money Borrowed</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Amount</Label><Input type="number" value={form.principal} onChange={e => setForm({ ...form, principal: e.target.value })} /></div>
              <div><Label>Loan Date</Label><Input type="date" value={form.loan_date} onChange={e => setForm({ ...form, loan_date: e.target.value })} /></div>
              <div><Label>Due Date</Label><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
              <div><Label>Interest Type</Label>
                <Select value={form.interest_type} onValueChange={v => setForm({ ...form, interest_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="simple">Simple</SelectItem><SelectItem value="compound">Compound</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Rate % (per yr)</Label><Input type="number" value={form.interest_rate} onChange={e => setForm({ ...form, interest_rate: e.target.value })} /></div>
              {form.interest_type === 'compound' && (
                <div className="col-span-2"><Label>Compound Frequency</Label>
                  <Select value={form.interest_frequency} onValueChange={v => setForm({ ...form, interest_frequency: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="yearly">Yearly</SelectItem></SelectContent>
                  </Select>
                </div>
              )}
              <div className="col-span-2"><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={submit} className="bg-gradient-to-r from-violet-600 to-fuchsia-600">Create Loan</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loans.length === 0 ? (
        <Card><CardContent className="p-12 text-center"><Wallet className="h-12 w-12 mx-auto text-slate-300 mb-3" /><p className="text-slate-500">No loans yet. Create your first one!</p></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {loans.map(l => (
            <Card key={l.id} onClick={() => onOpenLoan(l)} className="cursor-pointer hover:shadow-lg transition">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar><AvatarFallback className={l.type === 'given' ? 'bg-violet-100 text-violet-700' : 'bg-orange-100 text-orange-700'}>{l.borrower?.name?.[0]?.toUpperCase() || '?'}</AvatarFallback></Avatar>
                    <div>
                      <div className="font-semibold">{l.borrower?.name || 'Unknown'}</div>
                      <div className="text-xs text-slate-500 flex items-center gap-2">
                        {l.type === 'given' ? <><ArrowUpRight className="h-3 w-3" />Lent</> : <><ArrowDownLeft className="h-3 w-3" />Borrowed</>}
                        • {new Date(l.loan_date).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <Badge variant={l.computed.status === 'overdue' ? 'destructive' : l.computed.status === 'completed' ? 'default' : l.computed.status === 'due_soon' ? 'secondary' : 'outline'}>
                    {l.computed.status.replace('_', ' ')}
                  </Badge>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div><div className="text-xs text-slate-500">Principal</div><div className="font-semibold">{fmt(l.principal, l.currency)}</div></div>
                  <div><div className="text-xs text-slate-500">Interest</div><div className="font-semibold text-emerald-600">{fmt(l.computed.interest, l.currency)}</div></div>
                  <div><div className="text-xs text-slate-500">Outstanding</div><div className="font-semibold text-red-600">{fmt(l.computed.outstanding, l.currency)}</div></div>
                </div>
                {l.principal > 0 && (
                  <div className="mt-3">
                    <Progress value={(l.computed.total_paid / l.computed.total_due) * 100} />
                    <div className="flex justify-between text-xs text-slate-500 mt-1"><span>Paid {fmt(l.computed.total_paid, l.currency)}</span><span>{Math.round((l.computed.total_paid / l.computed.total_due) * 100) || 0}%</span></div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function LoanDetail({ loan, onClose, onRefresh, currency }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [notes, setNotes] = useState('');

  async function pay() {
    if (!amount) return toast.error('Enter amount');
    const r = await api(`loans/${loan.id}/repayments`, { method: 'POST', body: JSON.stringify({ amount, method, notes }) });
    if (r.id) { toast.success('Payment recorded'); setAmount(''); setNotes(''); onRefresh(); }
    else toast.error(r.error);
  }
  async function del() {
    if (!confirm('Delete this loan?')) return;
    await api(`loans/${loan.id}`, { method: 'DELETE' });
    toast.success('Deleted'); onClose(); onRefresh();
  }

  return (
    <Dialog open={!!loan} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2">Loan with {loan.borrower?.name}<Badge variant={loan.computed.status === 'overdue' ? 'destructive' : 'outline'}>{loan.computed.status.replace('_', ' ')}</Badge></DialogTitle></DialogHeader>
        <div className="grid grid-cols-4 gap-3 text-center">
          <div className="rounded-lg bg-violet-50 p-3"><div className="text-xs text-slate-500">Principal</div><div className="font-bold text-violet-700">{fmt(loan.principal, loan.currency)}</div></div>
          <div className="rounded-lg bg-emerald-50 p-3"><div className="text-xs text-slate-500">Interest</div><div className="font-bold text-emerald-700">{fmt(loan.computed.interest, loan.currency)}</div></div>
          <div className="rounded-lg bg-blue-50 p-3"><div className="text-xs text-slate-500">Paid</div><div className="font-bold text-blue-700">{fmt(loan.computed.total_paid, loan.currency)}</div></div>
          <div className="rounded-lg bg-red-50 p-3"><div className="text-xs text-slate-500">Outstanding</div><div className="font-bold text-red-700">{fmt(loan.computed.outstanding, loan.currency)}</div></div>
        </div>

        <div className="text-xs text-slate-500">
          {loan.interest_type === 'none' ? 'No interest' : `${loan.interest_type} interest at ${loan.interest_rate}% p.a.`}
          {' • '}{loan.computed.days_elapsed} days elapsed
          {loan.due_date && ` • Due ${new Date(loan.due_date).toLocaleDateString()}`}
        </div>

        <div className="border rounded-lg p-4 bg-slate-50">
          <div className="font-semibold text-sm mb-3">Record Payment</div>
          <div className="grid grid-cols-3 gap-2">
            <Input type="number" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} />
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="upi">UPI</SelectItem><SelectItem value="bank">Bank Transfer</SelectItem><SelectItem value="card">Card</SelectItem><SelectItem value="cheque">Cheque</SelectItem></SelectContent>
            </Select>
            <Button onClick={pay} className="bg-gradient-to-r from-emerald-500 to-teal-600">Add Payment</Button>
          </div>
        </div>

        <div>
          <div className="font-semibold text-sm mb-2">Payment History ({loan.repayments.length})</div>
          {loan.repayments.length === 0 ? <div className="text-xs text-slate-400">No payments yet</div> :
            <div className="space-y-2">{loan.repayments.map(r => (
              <div key={r.id} className="flex justify-between text-sm p-2 border rounded">
                <div><div className="font-medium">{fmt(r.amount, loan.currency)}</div><div className="text-xs text-slate-500">{r.method} • {new Date(r.date).toLocaleDateString()}</div></div>
              </div>
            ))}</div>
          }
        </div>

        <DialogFooter><Button variant="outline" onClick={del}><Trash2 className="h-4 w-4 mr-2" />Delete Loan</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BorrowersView({ borrowers, currency, onRefresh }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', notes: '', tags: [] });

  async function submit() {
    if (!form.name) return toast.error('Name required');
    const r = await api('borrowers', { method: 'POST', body: JSON.stringify(form) });
    if (r.id) { toast.success('Contact added'); setOpen(false); setForm({ name: '', phone: '', email: '', address: '', notes: '', tags: [] }); onRefresh(); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold">Contacts</h1><p className="text-sm text-slate-500 mt-1">People you lend to or borrow from.</p></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="bg-gradient-to-r from-violet-600 to-fuchsia-600"><PlusCircle className="h-4 w-4 mr-2" />New Contact</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Contact</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Full Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                <div><Label>Email</Label><Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              </div>
              <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
              <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={submit} className="bg-gradient-to-r from-violet-600 to-fuchsia-600">Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {borrowers.length === 0 ? (
        <Card><CardContent className="p-12 text-center"><Users className="h-12 w-12 mx-auto text-slate-300 mb-3" /><p className="text-slate-500">No contacts yet. Add someone!</p></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {borrowers.map(b => (
            <Card key={b.id}>
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12"><AvatarFallback className="bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">{b.name[0].toUpperCase()}</AvatarFallback></Avatar>
                  <div className="flex-1">
                    <div className="font-semibold">{b.name}</div>
                    <div className="text-xs text-slate-500">{b.phone || b.email || 'No contact info'}</div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div><div className="text-xs text-slate-500">Outstanding</div><div className="font-bold text-red-600">{fmt(b.outstanding, currency)}</div></div>
                  <div><div className="text-xs text-slate-500">Active</div><div className="font-bold">{b.active_loans}</div></div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <Badge variant="outline" className={
                    b.credit_score.label === 'Excellent' ? 'border-emerald-300 text-emerald-700 bg-emerald-50' :
                    b.credit_score.label === 'Good' ? 'border-blue-300 text-blue-700 bg-blue-50' :
                    b.credit_score.label === 'Poor' ? 'border-red-300 text-red-700 bg-red-50' :
                    'border-slate-300 text-slate-700 bg-slate-50'
                  }>
                    <BadgeCheck className="h-3 w-3 mr-1" />{b.credit_score.label} ({b.credit_score.score})
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ExpensesView({ items, currency, onRefresh }) {
  const [form, setForm] = useState({ category: 'Food', amount: '', date: new Date().toISOString().slice(0, 10), notes: '', method: 'cash' });
  async function add() {
    if (!form.amount) return toast.error('Amount required');
    const r = await api('expenses', { method: 'POST', body: JSON.stringify(form) });
    if (r.id) { toast.success('Expense added'); setForm({ ...form, amount: '', notes: '' }); onRefresh(); }
  }
  async function del(id) { await api(`expenses/${id}`, { method: 'DELETE' }); onRefresh(); }

  const total = items.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-5">
      <div><h1 className="text-3xl font-bold">Expenses</h1><p className="text-sm text-slate-500 mt-1">Total spent: <span className="font-semibold text-slate-900">{fmt(total, currency)}</span></p></div>

      <Card>
        <CardHeader><CardTitle className="text-base">Quick Add</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{EXPENSE_CATS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="number" placeholder="Amount" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
          <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          <Select value={form.method} onValueChange={v => setForm({ ...form, method: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="upi">UPI</SelectItem><SelectItem value="card">Card</SelectItem><SelectItem value="bank">Bank</SelectItem></SelectContent>
          </Select>
          <Input placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="md:col-span-1" />
          <Button onClick={add} className="bg-gradient-to-r from-violet-600 to-fuchsia-600"><PlusCircle className="h-4 w-4 mr-1" />Add</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? <div className="p-12 text-center text-slate-400">No expenses yet</div> :
            <div className="divide-y">
              {items.map(e => (
                <div key={e.id} className="flex items-center justify-between p-4 hover:bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-red-100 to-orange-100 flex items-center justify-center"><Receipt className="h-4 w-4 text-red-600" /></div>
                    <div>
                      <div className="font-medium text-sm">{e.category} {e.notes && <span className="text-slate-400">— {e.notes}</span>}</div>
                      <div className="text-xs text-slate-500">{new Date(e.date).toLocaleDateString()} • {e.method}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-red-600">- {fmt(e.amount, currency)}</div>
                    <Button variant="ghost" size="sm" onClick={() => del(e.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ))}
            </div>
          }
        </CardContent>
      </Card>
    </div>
  );
}

function IncomeView({ items, currency, onRefresh }) {
  const [form, setForm] = useState({ category: 'Salary', amount: '', date: new Date().toISOString().slice(0, 10), source: '', notes: '' });
  async function add() {
    if (!form.amount) return toast.error('Amount required');
    const r = await api('income', { method: 'POST', body: JSON.stringify(form) });
    if (r.id) { toast.success('Income added'); setForm({ ...form, amount: '', source: '', notes: '' }); onRefresh(); }
  }
  async function del(id) { await api(`income/${id}`, { method: 'DELETE' }); onRefresh(); }

  const total = items.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-5">
      <div><h1 className="text-3xl font-bold">Income</h1><p className="text-sm text-slate-500 mt-1">Total income: <span className="font-semibold text-emerald-700">{fmt(total, currency)}</span></p></div>
      <Card>
        <CardHeader><CardTitle className="text-base">Quick Add</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{INCOME_CATS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="number" placeholder="Amount" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
          <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          <Input placeholder="Source" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} />
          <Button onClick={add} className="bg-gradient-to-r from-emerald-500 to-teal-600"><PlusCircle className="h-4 w-4 mr-1" />Add</Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? <div className="p-12 text-center text-slate-400">No income entries yet</div> :
            <div className="divide-y">{items.map(e => (
              <div key={e.id} className="flex items-center justify-between p-4 hover:bg-slate-50">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center"><DollarSign className="h-4 w-4 text-emerald-600" /></div>
                  <div><div className="font-medium text-sm">{e.category} {e.source && <span className="text-slate-400">— {e.source}</span>}</div><div className="text-xs text-slate-500">{new Date(e.date).toLocaleDateString()}</div></div>
                </div>
                <div className="flex items-center gap-2"><div className="font-semibold text-emerald-600">+ {fmt(e.amount, currency)}</div><Button variant="ghost" size="sm" onClick={() => del(e.id)}><Trash2 className="h-3.5 w-3.5" /></Button></div>
              </div>
            ))}</div>
          }
        </CardContent>
      </Card>
    </div>
  );
}

function AIView() {
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);

  async function generate() {
    setLoading(true);
    try {
      const r = await api('ai/insights', { method: 'POST', body: JSON.stringify({}) });
      if (r.insights) { setInsights(r.insights); setGeneratedAt(r.generated_at); }
      else toast.error(r.error || 'Failed');
    } finally { setLoading(false); }
  }

  const iconMap = { trend: TrendingUp, alert: AlertTriangle, money: DollarSign, savings: Target, loan: Wallet };
  const colorMap = {
    warning: 'from-amber-500 to-orange-500 bg-amber-50 border-amber-200',
    positive: 'from-emerald-500 to-teal-600 bg-emerald-50 border-emerald-200',
    action: 'from-blue-500 to-indigo-600 bg-blue-50 border-blue-200',
    neutral: 'from-slate-500 to-slate-700 bg-slate-50 border-slate-200',
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Sparkles className="h-7 w-7 text-fuchsia-600" />AI Insights</h1>
          <p className="text-sm text-slate-500 mt-1">Claude Sonnet 4.5 analyzes your financial data and gives sharp, actionable insights.</p>
        </div>
        <Button onClick={generate} disabled={loading} className="bg-gradient-to-r from-violet-600 to-fuchsia-600">
          <Sparkles className="h-4 w-4 mr-2" />{loading ? 'Analyzing...' : insights.length ? 'Regenerate' : 'Generate Insights'}
        </Button>
      </div>

      {generatedAt && <div className="text-xs text-slate-400">Generated {new Date(generatedAt).toLocaleString()}</div>}

      {insights.length === 0 && !loading && (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <div className="h-16 w-16 mx-auto rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center mb-4"><Brain className="h-8 w-8 text-white" /></div>
            <h3 className="font-semibold text-lg">Ready to analyze your finances</h3>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">Add some loans, expenses, and income, then click <b>Generate Insights</b> to get personalized recommendations.</p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
          {[1, 2, 3, 4].map(i => <Card key={i}><CardContent className="p-5"><div className="h-4 w-1/3 bg-slate-200 rounded animate-pulse mb-3" /><div className="h-3 w-full bg-slate-100 rounded animate-pulse mb-2" /><div className="h-3 w-2/3 bg-slate-100 rounded animate-pulse" /></CardContent></Card>)}
        </div>
      )}

      {insights.length > 0 && (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
          {insights.map((ins, i) => {
            const Ic = iconMap[ins.icon] || TrendingUp;
            const c = (colorMap[ins.type] || colorMap.neutral).split(' ');
            const grad = `${c[0]} ${c[1]}`;
            const bg = c[2];
            const border = c[3];
            return (
              <Card key={i} className={`border ${border} ${bg}`}>
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <div className={`h-10 w-10 rounded-lg bg-gradient-to-br ${grad} flex items-center justify-center flex-shrink-0`}><Ic className="h-5 w-5 text-white" /></div>
                    <div className="flex-1">
                      <div className="font-semibold text-sm">{ins.title}</div>
                      <div className="text-sm text-slate-700 mt-1">{ins.insight}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function App() {
  const [tab, setTab] = useState('dashboard');
  const [currency, setCurrency] = useState('INR');
  const [dashboard, setDashboard] = useState(null);
  const [loans, setLoans] = useState([]);
  const [borrowers, setBorrowers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [income, setIncome] = useState([]);
  const [activeLoan, setActiveLoan] = useState(null);

  async function refresh() {
    const [d, l, b, e, i] = await Promise.all([
      api('dashboard'), api('loans'), api('borrowers'), api('expenses'), api('income'),
    ]);
    setDashboard(d); setLoans(l || []); setBorrowers(b || []); setExpenses(e || []); setIncome(i || []);
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar tab={tab} setTab={setTab} />
      <main className="flex-1">
        <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur px-6 py-3 flex items-center justify-between">
          <div className="md:hidden font-bold text-lg">Ledgr</div>
          <div className="hidden md:flex items-center gap-2 flex-1 max-w-md">
            <div className="relative flex-1"><Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input placeholder="Search contacts, loans, notes..." className="pl-9 bg-slate-50 border-slate-200" /></div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.keys(CURRENCIES).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </header>

        {/* Mobile nav */}
        <div className="md:hidden flex overflow-x-auto gap-1 p-2 border-b bg-white">
          {[['dashboard', 'Dashboard'], ['loans', 'Loans'], ['borrowers', 'Contacts'], ['expenses', 'Expenses'], ['income', 'Income'], ['ai', 'AI']].map(([id, l]) => (
            <button key={id} onClick={() => setTab(id)} className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${tab === id ? 'bg-violet-600 text-white' : 'bg-slate-100'}`}>{l}</button>
          ))}
        </div>

        <div className="p-6 max-w-7xl mx-auto">
          {tab === 'dashboard' && <Dashboard data={dashboard} currency={currency} onOpenLoan={setActiveLoan} />}
          {tab === 'loans' && <LoansView loans={loans} borrowers={borrowers} currency={currency} onRefresh={refresh} onOpenLoan={setActiveLoan} />}
          {tab === 'borrowers' && <BorrowersView borrowers={borrowers} currency={currency} onRefresh={refresh} />}
          {tab === 'expenses' && <ExpensesView items={expenses} currency={currency} onRefresh={refresh} />}
          {tab === 'income' && <IncomeView items={income} currency={currency} onRefresh={refresh} />}
          {tab === 'ai' && <AIView />}
        </div>

        {activeLoan && <LoanDetail loan={activeLoan} currency={currency} onClose={() => setActiveLoan(null)} onRefresh={async () => { await refresh(); const fresh = await api(`loans/${activeLoan.id}`); setActiveLoan(fresh); }} />}
      </main>
    </div>
  );
}

export default App;
