export default function CodeBlock({ title, code, language = "cpp" }) {
  return (
    <div className="glass-card rounded-2xl p-5 shadow-soft">
      {title ? (
        <div className="mb-3 text-sm font-semibold text-neutral-200 tracking-wide">
          {title}
        </div>
      ) : null}

      <pre className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-950/70 p-4 text-sm text-neutral-200">
        <code className={`language-${language}`}>
{code}
        </code>
      </pre>
    </div>
  );
}