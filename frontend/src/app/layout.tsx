import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DF-SSO',
  description: '大豐 SSO 登入驗證',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  );
}
