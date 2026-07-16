import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Discovery Engine',
  description: 'AI-powered semantic search for rental listings',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
