import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

export default function CodeBlock({ title, code, language = "cpp" }) {
  return (
    <div className="glass-card rounded-2xl p-5 shadow-soft">
      {title && (
        <div className="mb-3 text-sm font-semibold text-neutral-200 tracking-wide">
          {title}
        </div>
      )}

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
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}