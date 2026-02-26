import { useEffect } from "react";
import Prism from "prismjs";

export default function CodeBlock({ title, code, language = "cpp" }) {
  useEffect(() => {
    Prism.highlightAll();
  }, [code]);

  return (
    <div className="glass-card rounded-2xl p-5 shadow-soft">
      {title && (
        <div className="mb-3 text-sm font-semibold text-neutral-200 tracking-wide">
          {title}
        </div>
      )}

      <pre className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-950/70 p-4 text-sm">
        <code className={`language-${language}`}>
{code}
        </code>
      </pre>
    </div>
  );
}