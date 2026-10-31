import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers, highlightActiveLine, keymap } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { autocompletion } from "@codemirror/autocomplete";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
export default function CodeEditor({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const el = useRef<HTMLDivElement | null>(null), view = useRef<EditorView | null>(null), cb = useRef(onChange); cb.current = onChange;
  useEffect(() => {
    if (!el.current) return;
    const editor = new EditorView({ parent: el.current, state: EditorState.create({ doc: value, extensions: [
      lineNumbers(), highlightActiveLine(), history(), keymap.of([...defaultKeymap, ...historyKeymap]), javascript(), autocompletion(), EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": "Editor JavaScript" }),
      EditorView.theme({ "&": { backgroundColor: "var(--card)", color: "var(--foreground)", fontSize: "12px", minHeight: "300px" }, ".cm-scroller": { fontFamily: "monospace", maxHeight: "450px", overflow: "auto" }, ".cm-gutters": { backgroundColor: "var(--muted)", color: "var(--muted-foreground)", borderColor: "var(--border)" }, ".cm-activeLine": { backgroundColor: "var(--accent)" }, ".cm-cursor": { borderLeftColor: "var(--primary)" }, ".cm-tooltip": { backgroundColor: "var(--popover)", color: "var(--popover-foreground)" } }),
      syntaxHighlighting(HighlightStyle.define([{ tag: tags.keyword, color: "var(--chart-1)" }, { tag: tags.string, color: "var(--chart-2)" }, { tag: tags.number, color: "var(--chart-4)" }, { tag: tags.comment, color: "var(--muted-foreground)" }])),
      EditorView.updateListener.of((u) => { if (u.docChanged) cb.current(u.state.doc.toString()); }),
    ] }) });
    view.current = editor; return () => { view.current = null; editor.destroy(); };
    // Initial document only; subsequent changes synchronized below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { const editor = view.current; if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } }); }, [value]);
  return <div ref={el} className="overflow-hidden rounded-lg border" />;
}