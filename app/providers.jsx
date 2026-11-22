'use client';
import { SessionProvider } from 'next-auth/react';

// غلاف جلسة next-auth (Google OAuth) — يجب أن يكون مكوّن عميل.
export default function Providers({ children }) {
  return <SessionProvider>{children}</SessionProvider>;
}
