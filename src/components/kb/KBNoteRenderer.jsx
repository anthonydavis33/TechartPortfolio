import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import rehypeRaw from "rehype-raw";
import remarkWikiLinks from "../../lib/kb/remarkWikiLinks.js";
import remarkCallouts from "../../lib/kb/remarkCallouts.js";
import KBCallout from "./KBCallout.jsx";
import KBNoteEmbed from "./KBNoteEmbed.jsx";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { asset } from "../../utils/asset.js";
import { useNavigate } from "react-router-dom";

function KBImage({ src, alt, ...props }) {
  // Resolve __KB_ATTACHMENT__ prefix for Obsidian image embeds
  let resolved = src;
  if (src?.startsWith("__KB_ATTACHMENT__")) {
    const filename = src.replace("__KB_ATTACHMENT__", "");
    resolved = asset(`kb/attachments/${filename}`);
  } else if (src && !src.startsWith("http") && !src.startsWith("/")) {
    resolved = asset(`kb/${src}`);
  }

  return (
    <img
      src={resolved}
      alt={alt}
      className="rounded-xl border border-neutral-800 max-w-full my-3"
      loading="lazy"
      {...props}
    />
  );
}

function KBCode({ className, children, ...props }) {
  const match = /language-(\w+)/.exec(className || "");
  const code = String(children).replace(/\n$/, "");

  if (match) {
    return (
      <div className="rounded-xl border border-neutral-800 overflow-hidden my-3">
        <SyntaxHighlighter
          language={match[1]}
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            background: "rgba(3, 7, 18, 0.75)",
            padding: "16px",
            fontSize: "0.875rem",
            lineHeight: 1.6,
          }}
          codeTagProps={{
            style: {
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            },
          }}
          wrapLongLines={false}
          showLineNumbers={false}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <code
      className="rounded bg-neutral-800/70 px-1.5 py-0.5 text-sm text-accent-400 font-mono"
      {...props}
    >
      {children}
    </code>
  );
}

function KBLink({ href, children, className: _, ...props }) {
  const navigate = useNavigate();
  const linkStyle = "text-blue-400 hover:text-blue-300 underline decoration-blue-400/60 hover:decoration-blue-300 transition";

  // Internal KB links start with #/kb/
  if (href?.startsWith("#/kb/")) {
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          navigate(href.replace("#", ""));
        }}
        className={linkStyle}
        {...props}
      >
        {children}
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={linkStyle}
      {...props}
    >
      {children}
    </a>
  );
}

function KBEmbed({ node }) {
  const slug = node?.properties?.slug;
  const target = node?.properties?.target;
  if (!slug && !target) return null;
  return <KBNoteEmbed slug={slug} target={target} />;
}

export default function KBNoteRenderer({ content }) {
  if (!content) return null;

  return (
    <div className="kb-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkFrontmatter, remarkWikiLinks, remarkCallouts]}
        rehypePlugins={[rehypeRaw]}
        components={{
          code: KBCode,
          img: KBImage,
          a: KBLink,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-neutral-600 pl-4 italic text-neutral-400 my-4">
              {children}
            </blockquote>
          ),
          div: ({ node, children, ...props }) => {
            const calloutType = node?.properties?.dataCallout;
            if (calloutType) {
              return (
                <KBCallout
                  type={calloutType}
                  title={node.properties.dataCalloutTitle || calloutType}
                >
                  {children}
                </KBCallout>
              );
            }
            return <div {...props}>{children}</div>;
          },
          "kb-embed": KBEmbed,
          h1: ({ children }) => (
            <h1 className="text-2xl font-semibold text-neutral-50 mt-8 mb-4 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-semibold text-neutral-100 mt-7 mb-3">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-medium text-neutral-200 mt-5 mb-2">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-base font-medium text-neutral-200 mt-4 mb-2">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="text-neutral-300 leading-relaxed mb-4">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 text-neutral-300 mb-4 space-y-1">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 text-neutral-300 mb-4 space-y-1">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          hr: () => <hr className="border-neutral-800 my-6" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-4 rounded-xl border border-neutral-800">
              <table className="w-full text-sm text-neutral-300">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-neutral-900/60 text-neutral-200">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-4 py-2 text-left font-medium border-b border-neutral-800">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-2 border-b border-neutral-800/50">{children}</td>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-neutral-100">{children}</strong>
          ),
          em: ({ children }) => <em className="italic text-neutral-400">{children}</em>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
