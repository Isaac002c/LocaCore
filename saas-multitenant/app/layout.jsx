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
  // Ícones da marca TELUN (gerados da logo oficial). Vários tamanhos para o
  // navegador escolher o melhor na aba, nos favoritos e na tela de início.
  icons: {
    icon: [
      { url: BRAND.faviconSmall, sizes: '16x16', type: 'image/png' },
      { url: BRAND.favicon, sizes: '32x32', type: 'image/png' },
      { url: BRAND.faviconLarge, sizes: '48x48', type: 'image/png' },
      { url: BRAND.icon192, sizes: '192x192', type: 'image/png' },
    ],
    shortcut: BRAND.favicon,
    apple: [{ url: BRAND.appleIcon, sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    type: 'website',
    siteName: BRAND.productName,
    title: `${BRAND.productName} | ${BRAND.productTagline}`,
    description: BRAND.productDescription,
    locale: 'pt_BR',
    images: [{ url: BRAND.ogImage, width: 1200, height: 630, alt: `${BRAND.productName} — ${BRAND.productSignature}` }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${BRAND.productName} | ${BRAND.productTagline}`,
    description: BRAND.productDescription,
    images: [BRAND.ogImage],
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
