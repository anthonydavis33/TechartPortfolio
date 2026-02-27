import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

export default function CodeBlock({ title, code, language = "cpp" }) {
  // Bulletproof guard:
  // - handles null/undefined
  // - handles empty strings
  // - handles whitespace-only strings
  // - handles non-string inputs safely
  const safeCode =
    typeof code === "string"
      ? code
      : code == null
      ? ""
      : String(code);

  if (!safeCode.trim()) return null;

  const safeTitle =
    typeof title === "string"
      ? title.trim()
      : title == null
      ? ""
      : String(title).trim();

  return (
    <div className="glass-card rounded-2xl p-5 shadow-soft">
      {safeTitle ? (
        <div className="mb-3 text-sm font-semibold text-neutral-200 tracking-wide">
          {safeTitle}
        </div>
      ) : null}

      <div className="rounded-xl border border-neutral-800 overflow-hidden">
        <SyntaxHighlighter
          language={language}
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            background: "rgba(3, 7, 18, 0.75)", // dark, fits your glass theme
            padding: "16px",
            fontSize: "0.875rem",
            lineHeight: 1.6
          }}
          codeTagProps={{
            style: {
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
            }
          }}
          wrapLongLines={false}
          showLineNumbers={false}
        >
          {safeCode}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}