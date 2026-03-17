import { useKBNote } from "../../hooks/useKBNote";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";

export default function KBNoteEmbed({ slug, target, depth = 0 }) {
  const { title, content, loading, error } = useKBNote(slug);

  if (depth > 2) {
    return (
      <div className="my-3 rounded-lg border border-neutral-800 p-3 text-sm text-neutral-500 italic">
        Embed depth limit reached: {target || slug}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="my-3 rounded-lg border border-neutral-800 p-3 animate-pulse">
        <div className="h-4 bg-neutral-800 rounded w-1/3 mb-2" />
        <div className="h-3 bg-neutral-800 rounded w-2/3" />
      </div>
    );
  }

  if (error || !content) {
    return (
      <div className="my-3 rounded-lg border border-neutral-800 p-3 text-sm text-neutral-500 italic">
        Could not embed: {target || slug}
      </div>
    );
  }

  // Lazy import to avoid circular dependency at module level
  // We render a simplified version — just the markdown content without the full renderer
  return (
    <div className="my-3 rounded-lg border border-neutral-700/50 bg-neutral-900/30 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-semibold text-neutral-200">{title}</span>
        <Link
          to={`/kb/${slug}`}
          className="text-accent-400 hover:text-accent-500 transition"
        >
          <ExternalLink size={12} />
        </Link>
      </div>
      <div className="text-sm text-neutral-400 line-clamp-6 whitespace-pre-line">
        {content.slice(0, 500)}
        {content.length > 500 ? "..." : ""}
      </div>
    </div>
  );
}
