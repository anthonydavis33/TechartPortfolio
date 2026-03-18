import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, basename, dirname, extname, resolve } from "node:path";

const KB_DIR_NAME = "public/kb";
const OUT_NAME = "src/data/kb-manifest.json";

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      files.push(full);
    }
  }
  return files;
}

function extractFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { title: "", tags: [] };
  const fm = match[1];
  const title =
    fm.match(/title:\s*(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";

  // Support both inline [a, b] and YAML list (- a\n- b) tag formats
  const inlineMatch = fm.match(/tags:\s*\[([^\]]*)\]/);
  const listMatches = fm.match(/tags:\s*\n((?:\s+-\s+.+\n?)+)/);
  let tags = [];
  if (inlineMatch) {
    tags = inlineMatch[1].split(",").map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  } else if (listMatches) {
    tags = listMatches[1].match(/-\s+(.+)/g)?.map((t) => t.replace(/^- \s*/, "").trim().replace(/^["']|["']$/g, "")).filter(Boolean) || [];
  }
  return { title, tags };
}

async function generateManifest(root) {
  const kbDir = resolve(root, KB_DIR_NAME);
  const outPath = resolve(root, OUT_NAME);

  const files = await walk(kbDir);
  const foldersSet = new Set();
  const notes = [];

  for (const file of files) {
    const rel = relative(kbDir, file).replace(/\\/g, "/");
    const slug = rel.replace(/\.md$/, "");
    const folder = dirname(rel) === "." ? "" : dirname(rel);
    if (folder) foldersSet.add(folder);

    const raw = await readFile(file, "utf-8");
    const { title, tags } = extractFrontmatter(raw);

    notes.push({
      slug,
      filePath: `kb/${rel}`,
      title: title || basename(rel, ".md").replace(/-/g, " "),
      tags,
      folder,
    });
  }

  notes.sort((a, b) => a.slug.localeCompare(b.slug));
  const folders = [...foldersSet].sort();
  const json = JSON.stringify({ notes, folders }, null, 2);

  // Only write if content changed to avoid unnecessary HMR
  let existing = "";
  try {
    existing = await readFile(outPath, "utf-8");
  } catch {}
  if (existing !== json) {
    await writeFile(outPath, json);
    console.log(
      `[kb-manifest] Generated ${notes.length} notes, ${folders.length} folders.`
    );
    return true;
  }
  return false;
}

export function kbManifestPlugin() {
  let root = "";

  return {
    name: "vite-kb-manifest",

    configResolved(config) {
      root = config.root;
    },

    // Generate on server start
    async buildStart() {
      await generateManifest(root);
    },

    // Watch public/kb/ for changes during dev
    configureServer(server) {
      const kbDir = resolve(root, KB_DIR_NAME);

      server.watcher.add(kbDir);

      const regenerate = async (path) => {
        // Only react to .md file changes inside public/kb/
        const normalized = path.replace(/\\/g, "/");
        if (!normalized.includes("/public/kb/") || !normalized.endsWith(".md"))
          return;
        console.log(`[kb-manifest] Detected change: ${basename(path)}`);
        const changed = await generateManifest(root);
        if (changed) {
          // Trigger a full page reload since the manifest is imported statically
          server.ws.send({ type: "full-reload" });
        }
      };

      server.watcher.on("add", regenerate);
      server.watcher.on("change", regenerate);
      server.watcher.on("unlink", regenerate);
    },
  };
}
