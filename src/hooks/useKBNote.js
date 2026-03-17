import { useState, useEffect } from "react";
import { asset } from "../utils/asset";
import manifest from "../data/kb-manifest.json";

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { title: "", tags: [], content: raw };

  const fm = match[1];
  const content = raw.slice(match[0].length).trim();
  const title =
    fm.match(/title:\s*(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
  const tagsMatch = fm.match(/tags:\s*\[([^\]]*)\]/);
  const tags = tagsMatch
    ? tagsMatch[1]
        .split(",")
        .map((t) => t.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
    : [];

  return { title, tags, content };
}

export function useKBNote(slug) {
  const [state, setState] = useState({
    title: "",
    tags: [],
    content: "",
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!slug) {
      setState({ title: "", tags: [], content: "", loading: false, error: null });
      return;
    }

    const note = manifest.notes.find((n) => n.slug === slug);
    if (!note) {
      setState({
        title: "",
        tags: [],
        content: "",
        loading: false,
        error: "Note not found",
      });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    fetch(asset(note.filePath))
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch note: ${r.status}`);
        return r.text();
      })
      .then((raw) => {
        if (cancelled) return;
        const { title, tags, content } = parseFrontmatter(raw);
        setState({
          title: title || note.title,
          tags: tags.length ? tags : note.tags,
          content,
          loading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          title: "",
          tags: [],
          content: "",
          loading: false,
          error: err.message,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return state;
}
