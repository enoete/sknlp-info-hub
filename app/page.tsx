export default function Home() {
  return (
    <main className="max-w-5xl mx-auto px-9 py-12">
      <div className="text-xs font-bold tracking-widest uppercase text-red mb-2">
        Official record
      </div>
      <h1 className="font-display text-4xl mb-3">SKNLP INFO HUB</h1>
      <p className="text-muted max-w-xl mb-8">
        This is the working starter. Pixel-accurate design reference lives at{' '}
        <code className="font-mono text-sm">/design-reference/mockup.html</code> — open it
        side-by-side and rebuild each view (Dashboard, Ask the Record, Opposition Watch,
        Speakers, Calendar, Review Queue) as real components backed by{' '}
        <code className="font-mono text-sm">schema.sql</code>. See{' '}
        <code className="font-mono text-sm">CLAUDE.md</code> for full project context.
      </p>
      <div className="grid grid-cols-4 gap-3">
        {['113 accomplishments', '412 sources', '18 opposition claims', '4 years covered'].map(
          (label) => (
            <div key={label} className="bg-paper border border-line rounded p-4">
              <div className="text-xs text-muted font-semibold">{label}</div>
            </div>
          )
        )}
      </div>
    </main>
  );
}
