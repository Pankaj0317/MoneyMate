import './globals.css';
import { Toaster } from '@/components/ui/sonner';

export const metadata = {
  title: 'Ledgr — Smart Expense & Loan Manager',
  description: 'AI-powered digital ledger for loans, expenses, income, and financial insights.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
