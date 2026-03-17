import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, ChevronRight, ChevronDown, FileText, FolderOpen, X } from "lucide-react";
import { useKBSearch, useAllTags } from "../../hooks/useKBSearch";
import manifest from "../../data/kb-manifest.json";

function FolderTree({ notes, activeSlug }) {
  const [expanded, setExpanded] = useState(() => {
    // Expand folder containing active note by default
    const folders = new Set();
    if (activeSlug) {
      const parts = activeSlug.split("/");
      if (parts.length > 1) folders.add(parts[0]);
    }
    // Also expand all folders initially
    for (const f of manifest.folders) folders.add(f);
    return folders;
  });

  const toggle = (folder) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  // Group notes by folder
  const rootNotes = notes.filter((n) => !n.folder);
  const byFolder = {};
  for (const n of notes) {
    if (n.folder) {
      if (!byFolder[n.folder]) byFolder[n.folder] = [];
      byFolder[n.folder].push(n);
    }
  }

  const folders = Object.keys(byFolder).sort();

  return (
    <nav className="space-y-1">
      {rootNotes.map((note) => (
        <NoteLink key={note.slug} note={note} active={activeSlug === note.slug} />
      ))}

      {folders.map((folder) => (
        <div key={folder}>
          <button
            onClick={() => toggle(folder)}
            className="flex items-center gap-1.5 w-full px-2 py-1.5 text-sm text-neutral-400 hover:text-neutral-200 transition rounded-lg hover:bg-neutral-800/40"
          >
            {expanded.has(folder) ? (
              <ChevronDown size={14} className="shrink-0" />
            ) : (
              <ChevronRight size={14} className="shrink-0" />
            )}
            <FolderOpen size={14} className="shrink-0 text-accent-400/70" />
            <span className="truncate capitalize">{folder}</span>
          </button>

          {expanded.has(folder) && (
            <div className="ml-3 pl-2 border-l border-neutral-800/60">
              {byFolder[folder].map((note) => (
                <NoteLink
                  key={note.slug}
                  note={note}
                  active={activeSlug === note.slug}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

function NoteLink({ note, active }) {
  return (
    <Link
      to={`/kb/${note.slug}`}
      className={`flex items-center gap-1.5 px-2 py-1.5 text-sm rounded-lg transition truncate ${
        active
          ? "bg-accent-400/10 text-accent-400 border-l-2 border-accent-400 -ml-[1px]"
          : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40"
      }`}
    >
      <FileText size={14} className="shrink-0" />
      <span className="truncate">{note.title}</span>
    </Link>
  );
}

export default function KBSidebar({ activeSlug, isOpen, onClose }) {
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState([]);
  const filteredNotes = useKBSearch(query, activeTags);
  const allTags = useAllTags();

  const toggleTag = (tag) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 h-full w-72 z-50 bg-neutral-950/95 backdrop-blur-xl border-r border-neutral-800/60
          transition-transform duration-200
          md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:z-auto md:translate-x-0 md:bg-transparent md:backdrop-blur-none md:border-r-0
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="flex flex-col h-full p-4 overflow-y-auto">
          {/* Mobile close button */}
          <button
            onClick={onClose}
            className="md:hidden self-end mb-2 p-1 text-neutral-400 hover:text-white transition"
          >
            <X size={20} />
          </button>

          {/* Search */}
          <div className="relative mb-3">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
            />
            <input
              type="text"
              placeholder="Search notes..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm bg-neutral-900/60 border border-neutral-800 rounded-xl text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-accent-400/40 transition"
            />
          </div>

          {/* Tags */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-2 py-0.5 text-xs rounded-full border transition ${
                    activeTags.includes(tag)
                      ? "bg-accent-400/15 border-accent-400/40 text-accent-400"
                      : "border-neutral-800 text-neutral-500 hover:text-neutral-300 hover:border-neutral-700"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          {/* Folder Tree */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {filteredNotes.length === 0 ? (
              <p className="text-sm text-neutral-600 italic px-2">No notes found</p>
            ) : (
              <FolderTree notes={filteredNotes} activeSlug={activeSlug} />
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
