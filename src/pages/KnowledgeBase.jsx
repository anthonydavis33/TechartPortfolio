import { useLocation } from "react-router-dom";
import { Menu, BookOpen } from "lucide-react";
import { useState } from "react";
import Navbar from "../components/Navbar.jsx";
import Footer from "../components/Footer.jsx";
import KBSidebar from "../components/kb/KBSidebar.jsx";
import KBNoteRenderer from "../components/kb/KBNoteRenderer.jsx";
import { useKBNote } from "../hooks/useKBNote.js";
import manifest from "../data/kb-manifest.json";

function WelcomeView() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <BookOpen size={48} className="text-accent-400/40 mb-4" />
      <h2 className="text-xl font-semibold text-neutral-200 mb-2">
        Knowledge Base
      </h2>
      <p className="text-neutral-500 max-w-md">
        A collection of notes, findings, and documentation from working with
        Unreal Engine 5. Select a note from the sidebar to get started.
      </p>
      {manifest.notes.length > 0 && (
        <p className="text-neutral-600 text-sm mt-4">
          {manifest.notes.length} note{manifest.notes.length !== 1 ? "s" : ""} across{" "}
          {manifest.folders.length} folder{manifest.folders.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

function NoteView({ slug }) {
  const { title, tags, content, loading, error } = useKBNote(slug);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 py-8">
        <div className="h-6 bg-neutral-800 rounded w-1/3" />
        <div className="h-4 bg-neutral-800 rounded w-2/3" />
        <div className="h-4 bg-neutral-800 rounded w-1/2" />
        <div className="h-4 bg-neutral-800 rounded w-3/4" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-20 text-center">
        <p className="text-neutral-500 mb-2">Note not found</p>
        <p className="text-neutral-600 text-sm">
          The note <code className="text-accent-400">{slug}</code> doesn't exist
          in the knowledge base.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-xs rounded-full border border-neutral-800 text-neutral-500"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <KBNoteRenderer content={content} />
    </div>
  );
}

export default function KnowledgeBase() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Extract slug from the path: /kb/some/slug -> some/slug
  const slug = location.pathname.replace(/^\/kb\/?/, "") || "";

  return (
    <div className="min-h-screen bg-grid">
      <Navbar />

      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="flex min-h-[calc(100vh-4rem)]">
          {/* Mobile sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="fixed bottom-5 right-5 z-30 md:hidden p-3 rounded-full bg-accent-500 text-white shadow-lg hover:bg-accent-600 transition"
          >
            <Menu size={20} />
          </button>

          {/* Sidebar */}
          <KBSidebar
            activeSlug={slug}
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />

          {/* Content */}
          <main className="flex-1 min-w-0 py-6 md:pl-6">
            <div className="glass-card rounded-2xl p-6 md:p-8">
              {slug ? <NoteView slug={slug} /> : <WelcomeView />}
            </div>
          </main>
        </div>
      </div>

      <Footer />
    </div>
  );
}
