import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://directory.shinyjets.com';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Find an Aircraft Detailer by Airport | Shiny Jets Directory",
  description: "Browse aircraft detailers listed in the Shiny Jets directory. Search by home airport and request a quote online.",
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Shiny Jets Directory',
    title: 'Find an Aircraft Detailer by Airport | Shiny Jets Directory',
    description: 'Browse aircraft detailers listed in the Shiny Jets directory. Search by home airport and request a quote online.',
    images: [{ url: '/logos/shiny-jets-dark.png', alt: 'Shiny Jets' }],
  },
  twitter: { card: 'summary', title: 'Find an Aircraft Detailer by Airport | Shiny Jets Directory' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${poppins.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
