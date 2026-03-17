import manifest from "../../data/kb-manifest.json";

const IMAGE_EXTS = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i;

export function isImageLink(target) {
  return IMAGE_EXTS.test(target);
}

/**
 * Resolve an Obsidian-style wikilink target to a manifest slug.
 * Obsidian uses shortest-unique-path matching:
 *   "Blueprints Basics" matches "unreal/blueprints-basics"
 */
export function resolveWikiLink(target) {
  if (!target) return null;

  // Normalize: lowercase, trim, replace spaces with hyphens
  const normalized = target.trim().toLowerCase().replace(/\s+/g, "-");

  // Exact slug match first
  const exact = manifest.notes.find(
    (n) => n.slug.toLowerCase() === normalized
  );
  if (exact) return exact.slug;

  // Basename match (Obsidian's default — match just the filename part)
  const byBasename = manifest.notes.find((n) => {
    const parts = n.slug.toLowerCase().split("/");
    return parts[parts.length - 1] === normalized;
  });
  if (byBasename) return byBasename.slug;

  // Title match (case-insensitive)
  const byTitle = manifest.notes.find(
    (n) => n.title.toLowerCase() === target.trim().toLowerCase()
  );
  if (byTitle) return byTitle.slug;

  return null;
}
