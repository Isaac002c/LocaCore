import './globals.css';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'Nexos | Gestão inteligente para despachantes',
  description: 'Plataforma de gestão para despachantes desenvolvida pela Chronostek.',
  applicationName: 'Nexos',
  authors: [{ name: 'Chronostek' }],
  creator: 'Chronostek',
  publisher: 'Chronostek',
  icons: {
    icon: '/icon.png',
    shortcut: '/icon.png',
    apple: '/icon.png',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>{children}</body>
    </html>
  );
}

