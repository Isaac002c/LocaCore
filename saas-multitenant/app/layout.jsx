import './globals.css';
import './telun-shell.css';
import { Inter } from 'next/font/google';
import EnvBanner from './components/EnvBanner';
import { BRAND, TELUN_COLORS } from './lib/brand';

const inter = Inter({ subsets: ['latin'] });

// Metadados institucionais — todos derivados de app/lib/brand.js (§11).
export const metadata = {
  title: `${BRAND.productName} | ${BRAND.productTagline}`,
  description: BRAND.productDescription,
  applicationName: BRAND.productName,
  authors: [{ name: BRAND.companyName }],
  creator: BRAND.companyName,
  publisher: BRAND.companyName,
  manifest: '/manifest.webmanifest',
  // Só SVG por enquanto — os PNGs (apple-touch/PWA/OG) estão pendentes dos
  // arquivos oficiais da TELUN. Ver public/brand/README.md.
  icons: {
    icon: BRAND.favicon,
    shortcut: BRAND.favicon,
  },
  openGraph: {
    type: 'website',
    siteName: BRAND.productName,
    title: `${BRAND.productName} | ${BRAND.productTagline}`,
    description: BRAND.productDescription,
    locale: 'pt_BR',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${BRAND.productName} | ${BRAND.productTagline}`,
    description: BRAND.productDescription,
  },
  // Área autenticada: não deve ser indexada.
  robots: { index: false, follow: false },
};

export const viewport = {
  themeColor: TELUN_COLORS.cosmic,
  width: 'device-width',
  initialScale: 1,
};

// Aplica o tema ANTES da primeira pintura, evitando flash de tela clara.
// Prioridade: preferência salva → preferência do SO → escuro (§7).
const THEME_BOOTSTRAP = `
(function(){try{
  var m=localStorage.getItem('locacore-theme');
  var t=(m==='light'||m==='dark')?m:
    (m==='system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark')
      : 'dark');
  document.documentElement.setAttribute('data-theme',t);
}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className={inter.className}>
        <EnvBanner />
        {children}
      </body>
    </html>
  );
}
