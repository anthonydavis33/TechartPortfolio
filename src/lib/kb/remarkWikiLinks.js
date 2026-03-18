import { visit } from "unist-util-visit";
import { resolveWikiLink, isImageLink } from "./resolveWikiLink.js";

/**
 * Custom remark plugin to transform Obsidian-style [[wikilinks]] and ![[embeds]].
 *
 * Handles:
 *   [[Target]]           → internal link
 *   [[Target|Alias]]     → internal link with display text
 *   ![[image.png]]       → image embed
 *   ![[Note]]            → note transclusion (rendered by KBNoteEmbed)
 */
export default function remarkWikiLinks() {
  return (tree) => {
    visit(tree, "text", (node, index, parent) => {
      if (!parent || index === undefined) return;

      const regex = /(!?)\[\[([^\]]+)\]\]/g;
      const parts = [];
      let last = 0;
      let match;

      while ((match = regex.exec(node.value)) !== null) {
        // Text before this match
        if (match.index > last) {
          parts.push({ type: "text", value: node.value.slice(last, match.index) });
        }

        const isEmbed = match[1] === "!";
        const inner = match[2];
        const [target, alias] = inner.split("|").map((s) => s.trim());

        if (isEmbed && isImageLink(target)) {
          // Image embed: ![[image.png]]
          parts.push({
            type: "image",
            url: `__KB_ATTACHMENT__${target}`,
            alt: alias || target,
          });
        } else if (isEmbed) {
          // Note transclusion: ![[Note]]
          const slug = resolveWikiLink(target);
          parts.push({
            type: "html",
            value: `<kb-embed slug="${slug || ""}" target="${target}"></kb-embed>`,
          });
        } else {
          // Internal link: [[Target]] or [[Target|Alias]]
          const slug = resolveWikiLink(target);
          if (slug) {
            parts.push({
              type: "link",
              url: `#/kb/${slug}`,
              children: [{ type: "text", value: alias || target }],
              data: { hProperties: { className: "kb-wikilink" } },
            });
          } else {
            // Unresolved link — render as broken link
            parts.push({
              type: "html",
              value: `<span class="kb-wikilink-broken" title="Note not found: ${target}">${alias || target}</span>`,
            });
          }
        }

        last = match.index + match[0].length;
      }

      // Remaining text after last match
      if (last < node.value.length) {
        parts.push({ type: "text", value: node.value.slice(last) });
      }

      if (parts.length > 0) {
        parent.children.splice(index, 1, ...parts);
        return index + parts.length;
      }
    });
  };
}
