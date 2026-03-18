#!/usr/bin/env node
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, relative, basename, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const KB_DIR = join(ROOT, "public", "kb");
const OUT = join(ROOT, "src", "data", "kb-manifest.json");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
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
  const title = fm.match(/title:\s*(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
  const tagsMatch = fm.match(/tags:\s*\[([^\]]*)\]/);
  const tags = tagsMatch
    ? tagsMatch[1].split(",").map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
    : [];
  return { title, tags };
}

async function main() {
  let files;
  try {
    files = await walk(KB_DIR);
  } catch {
    // No kb directory yet — write empty manifest
    await writeFile(OUT, JSON.stringify({ notes: [], folders: [] }, null, 2));
    console.log("[kb-manifest] No public/kb/ directory found — wrote empty manifest.");
    return;
  }

  const foldersSet = new Set();
  const notes = [];

  for (const file of files) {
    const rel = relative(KB_DIR, file).replace(/\\/g, "/");
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

  await writeFile(OUT, JSON.stringify({ notes, folders }, null, 2));
  console.log(`[kb-manifest] Generated ${notes.length} notes, ${folders.length} folders.`);
}

main();
