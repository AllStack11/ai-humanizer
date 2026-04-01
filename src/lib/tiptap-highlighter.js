import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const BLOCK_SEPARATOR = "\n\n";

function findMatches(doc, getRanges) {
  const decorations = [];
  const fullText = doc.textBetween(0, doc.content.size, BLOCK_SEPARATOR, BLOCK_SEPARATOR);
  const ranges = (getRanges(fullText) || [])
    .filter((range) => Number.isInteger(range?.start) && Number.isInteger(range?.end) && range.end > range.start);

  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text || "";
    if (!text) return;

    const textStart = doc.textBetween(0, pos, BLOCK_SEPARATOR, BLOCK_SEPARATOR).length;
    const textEnd = textStart + text.length;

    ranges.forEach((range) => {
      const overlapStart = Math.max(range.start, textStart);
      const overlapEnd = Math.min(range.end, textEnd);
      if (overlapEnd <= overlapStart) return;

      // Support both range.class (direct) and range.kind (mapped)
      const cls = range.class ?? (
        range.kind === "error" ? "mark-error" :
        range.kind === "cliche" ? "mark-cliche" :
        range.kind === "diff-added" ? "mark-diff-added" :
        range.kind === "diff-removed" ? "mark-diff-removed" :
        null
      );
      if (!cls) return;

      const from = pos + (overlapStart - textStart);
      const to = pos + (overlapEnd - textStart);
      if (to <= from) return;

      decorations.push(Decoration.inline(from, to, { nodeName: "mark", class: cls }));
    });
  });

  return DecorationSet.create(doc, decorations);
}

export const DynamicHighlighter = Extension.create({
  name: "dynamicHighlighter",

  addOptions() {
    return {
      getRanges: () => [],
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("dynamicHighlighter"),
        state: {
          init: (_, { doc }) => findMatches(doc, this.options.getRanges),
          apply: (tr, oldState) => {
            if (!tr.docChanged && !tr.getMeta("dynamicHighlighterUpdate")) {
              return oldState.map(tr.mapping, tr.doc);
            }
            return findMatches(tr.doc, this.options.getRanges);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

// Manages a single locked decoration range (for selection-active and regen-pending highlights).
// Dispatch meta "selectionLock" with { from, to, className } to set, or { className: "" } to clear.
export const SelectionAwareHighlighter = Extension.create({
  name: "selectionAwareHighlighter",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("selectionAwareHighlighter"),
        state: {
          init: () => ({ from: 0, to: 0, className: "", decorations: DecorationSet.empty }),
          apply(tr, old) {
            const meta = tr.getMeta("selectionLock");
            if (meta !== undefined) {
              const { from, to, className } = meta;
              if (!className || !to || to <= from) {
                return { from: 0, to: 0, className: "", decorations: DecorationSet.empty };
              }
              const deco = Decoration.inline(from, to, { nodeName: "mark", class: className });
              return { from, to, className, decorations: DecorationSet.create(tr.doc, [deco]) };
            }
            // No meta — remap existing decorations through the transaction
            if (!old.className) return old;
            return { ...old, decorations: old.decorations.map(tr.mapping, tr.doc) };
          },
        },
        props: {
          decorations(state) {
            return this.getState(state).decorations;
          },
        },
      }),
    ];
  },
});
