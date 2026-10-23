export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white flex flex-col items-center justify-center px-6">
      <a href="https://shinyjets.com" className="mb-10"><img src="/logos/shiny-jets-dark.png" alt="Shiny Jets" className="h-10 object-contain" /></a>
      <div className="text-center max-w-md">
        <h1 className="text-5xl font-light mb-4">404</h1>
        <p className="text-white/60 mb-8">We couldn&apos;t find that page.</p>
        <a href="/" className="inline-block px-5 py-2.5 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors">Browse all detailers</a>
        <p className="text-white/40 text-xs mt-8"><a href="/contact" className="hover:text-white/70">Contact</a> · <a href="/privacy" className="hover:text-white/70">Privacy</a> · <a href="/terms" className="hover:text-white/70">Terms</a></p>
      </div>
    </div>
  );
}
