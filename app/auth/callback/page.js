'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AuthCallback() {
  const router = useRouter();
  const [status, setStatus] = useState('Signing you in...');

  useEffect(() => {
    async function run() {
      const hash = typeof window !== 'undefined' ? window.location.hash : '';
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const sessionId = params.get('session_id');
      if (!sessionId) { setStatus('Missing session id.'); return; }
      try {
        const r = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const d = await r.json();
        if (d.success) {
          // Clean hash and redirect
          window.history.replaceState({}, document.title, '/');
          router.replace('/');
        } else {
          setStatus(d.error || 'Login failed');
        }
      } catch (e) {
        setStatus(e.message || 'Login failed');
      }
    }
    run();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-violet-50 to-fuchsia-50">
      <div className="text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 animate-pulse" />
        <div className="mt-4 text-slate-700 font-medium">{status}</div>
      </div>
    </div>
  );
}
