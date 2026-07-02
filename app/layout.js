import './globals.css';
import { Toaster } from '@/components/ui/sonner';

export const metadata = {
  title: 'MoneyMate — Smart Expense & Loan Manager',
  description: 'AI-powered digital ledger for loans, expenses, income, and financial insights.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'MoneyMate' },
  icons: { icon: '/icon-192.svg', apple: '/icon-192.svg' },
};

export const viewport = {
  themeColor: '#8b5cf6',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Toaster position="top-right" richColors />
        <script dangerouslySetInnerHTML={{ __html: `if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{})); }` }} />
      </body>
    </html>
  );
}
