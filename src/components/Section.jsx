export default function Section({ id, eyebrow, title, children }) {
  return (
    <section id={id} className="scroll-mt-24 py-16">
      <div className="mx-auto w-full max-w-6xl px-5">
        <div className="mb-8">
          {eyebrow && (
            <div className="text-xs font-semibold tracking-widest text-accent-400/90 uppercase">
              {eyebrow}
            </div>
          )}
          <h2 className="mt-2 text-2xl md:text-3xl font-semibold text-neutral-50">
            {title}
          </h2>
        </div>
        {children}
      </div>
    </section>
  );
}