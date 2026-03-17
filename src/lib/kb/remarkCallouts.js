import { visit } from "unist-util-visit";

/**
 * Custom remark plugin to transform Obsidian-style callouts into HTML.
 * Uses rehype-raw to parse the resulting HTML.
 *
 * Input:
 *   > [!NOTE]
 *   > This is a note callout
 *
 * Output:
 *   <kb-callout type="note" title="Note">This is a note callout</kb-callout>
 */
export default function remarkCallouts() {
  return (tree) => {
    visit(tree, "blockquote", (node, index, parent) => {
      if (!parent || index === undefined) return;

      const firstChild = node.children?.[0];
      if (!firstChild || firstChild.type !== "paragraph") return;

      const firstText = firstChild.children?.[0];
      if (!firstText || firstText.type !== "text") return;

      const match = firstText.value.match(/^\[!(\w+)\](?:[ \t]+(.+))?/);
      if (!match) return;

      const calloutType = match[1].toLowerCase();
      const customTitle =
        match[2]?.trim() ||
        calloutType.charAt(0).toUpperCase() + calloutType.slice(1);

      // Remove only the [!TYPE] marker (and optional inline title) from the first line
      const remaining = firstText.value.replace(/^\[!\w+\](?:[ \t]+.+)?[ \t]*\n?/, "");
      if (remaining.trim()) {
        firstText.value = remaining;
      } else {
        firstChild.children.shift();
        if (firstChild.children.length === 0) {
          node.children.shift();
        }
      }

      // Replace the blockquote with HTML wrapper + children
      // We wrap in opening/closing HTML tags and keep the inner content as mdast nodes
      const openTag = {
        type: "html",
        value: `<div class="kb-callout" data-callout="${calloutType}" data-callout-title="${customTitle}">`,
      };
      const closeTag = {
        type: "html",
        value: `</div>`,
      };

      parent.children.splice(index, 1, openTag, ...node.children, closeTag);
      return index + node.children.length + 2;
    });
  };
}
