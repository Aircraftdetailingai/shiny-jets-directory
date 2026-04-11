export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <h1 className="text-5xl font-light mb-4">404</h1>
        <p className="text-white/60 mb-8">We couldn't find that detailer. They may not be listed in the directory yet.</p>
        <a href="/" className="inline-block px-5 py-2.5 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors">
          Browse all detailers
        </a>
      </div>
    </div>
  );
}
