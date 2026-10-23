import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact | Shiny Jets Directory',
  description: 'Contact Shiny Jets at Threshold Aviation, Chino Airport, Chino, CA.',
  alternates: { canonical: '/contact' },
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="https://shinyjets.com"><img src="/logos/shiny-jets-dark.png" alt="Shiny Jets" className="h-8 object-contain" /></a>
          <a href="/" className="text-xs text-white/60 hover:text-white">&larr; Back to directory</a>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-light tracking-tight mb-6">Contact Shiny Jets</h1>
        <address className="not-italic text-white/80 leading-7 mb-6">
          Shiny Jets<br />
          Threshold Aviation<br />
          8352 Kimball Ave<br />
          Chino Airport, Chino, CA
        </address>
        <p className="mb-8"><a href="tel:+18582674469" className="text-blue-400 hover:text-blue-300">858-267-4469</a></p>
        <p className="text-white/60 text-sm">
          Looking for a detailer? <a href="/" className="text-blue-400">Browse the directory</a>. Detailers can manage their listing by signing in to the{' '}
          <a href="https://crm.shinyjets.com/portal/login?ref=directory-contact" className="text-blue-400">Shiny Jets CRM</a>.
        </p>
        <p className="text-white/40 text-xs mt-10">
          <a href="/privacy" className="hover:text-white/70">Privacy</a> · <a href="/terms" className="hover:text-white/70">Terms</a>
        </p>
      </main>
    </div>
  );
}
