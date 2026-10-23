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
  title: "Find a Certified Aircraft Detailer | Shiny Jets",
  description: "Browse the Shiny Jets directory of certified aircraft detailing professionals. Find detailers by airport, request quotes online.",
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Shiny Jets Directory',
    title: 'Find a Certified Aircraft Detailer | Shiny Jets',
    description: 'Browse the Shiny Jets directory of certified aircraft detailing professionals. Find detailers by airport, request quotes online.',
    images: [{ url: '/logos/shiny-jets-dark.png', alt: 'Shiny Jets' }],
  },
  twitter: { card: 'summary', title: 'Find a Certified Aircraft Detailer | Shiny Jets' },
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
