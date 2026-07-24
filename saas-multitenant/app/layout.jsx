import './globals.css';
import { Inter } from 'next/font/google';
import EnvBanner from './components/EnvBanner';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'LocaCore | Gestão para locadoras de veículos',
  description: 'Plataforma de gestão para locadoras de veículos, fornecida pela TELUN.',
  applicationName: 'LocaCore',
  authors: [{ name: 'TELUN' }],
  creator: 'TELUN',
  publisher: 'TELUN',
  icons: {
    icon: '/icon.png',
    shortcut: '/icon.png',
    apple: '/icon.png',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>
        <EnvBanner />
        {children}
      </body>
    </html>
  );
}

