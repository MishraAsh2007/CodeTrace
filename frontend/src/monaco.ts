// Monaco is bundled locally (no CDN), so the editor works offline.
// Only the core editor, its standard features, and Python highlighting are included.
import * as monaco from "monaco-editor/editor";
import "monaco-editor/features/register.all";
import "monaco-editor/languages/definitions/python/register";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

monaco.editor.defineTheme("kiro-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6b7394", fontStyle: "italic" },
    { token: "keyword", foreground: "c792ea" },
    { token: "string", foreground: "a5e28b" },
    { token: "number", foreground: "f0b37e" },
  ],
  colors: {
    "editor.background": "#131722",
    "editorGutter.background": "#131722",
    "editor.lineHighlightBackground": "#ffffff08",
    "editorLineNumber.foreground": "#3d4458",
    "editorLineNumber.activeForeground": "#a3abc2",
    "editorCursor.foreground": "#b48cff",
    "editor.selectionBackground": "#7c8cff40",
  },
});

export { monaco };
