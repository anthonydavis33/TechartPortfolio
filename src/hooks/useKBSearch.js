import { useMemo } from "react";
import manifest from "../data/kb-manifest.json";

export function useKBSearch(query, activeTags) {
  return useMemo(() => {
    let notes = manifest.notes;
    const q = (query || "").toLowerCase().trim();

    if (q) {
      notes = notes.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.slug.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    if (activeTags && activeTags.length > 0) {
      notes = notes.filter((n) =>
        activeTags.every((tag) => n.tags.includes(tag))
      );
    }

    return notes;
  }, [query, activeTags]);
}

export function useAllTags() {
  return useMemo(() => {
    const tagSet = new Set();
    for (const note of manifest.notes) {
      for (const tag of note.tags) tagSet.add(tag);
    }
    return [...tagSet].sort();
  }, []);
}
