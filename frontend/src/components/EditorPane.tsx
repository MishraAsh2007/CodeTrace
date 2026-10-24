import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { monaco } from "../monaco";

/** What to show on the current line: highlight, gutter arrow/cross, inline hint, error squiggle. */
export interface ExecMark {
  line: number;
  isError: boolean;
  hint: { text: string; alert: boolean } | null;
  marker: string | null;
  reveal: boolean;
}

export interface EditorHandle {
  getValue(): string;
  setValue(code: string): void;
  getBreakpoints(): number[];
  setBreakpoints(lines: number[]): void;
  toggleBreakpointAtCursor(): void;
  flashLine(line: number): void;
  focus(): void;
}

interface Props {
  ref?: Ref<EditorHandle>;
  initialCode: string;
  initialBreakpoints: number[];
  exec: ExecMark | null;
  dirty: boolean;
  onChange: (code: string) => void;
  onBreakpointsChange: (lines: number[]) => void;
}

const MARKER_OWNER = "kiro";

export function EditorPane({ ref, initialCode, initialBreakpoints, exec, dirty, onChange, onBreakpointsChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const bpDecos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const execDecos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const callbacks = useRef({ onChange, onBreakpointsChange });
  callbacks.current = { onChange, onBreakpointsChange };

  const breakpointLines = () =>
    [...new Set((bpDecos.current?.getRanges() ?? []).map((r) => r.startLineNumber))].sort((a, b) => a - b);

  const setBreakpoints = (lines: number[], notify = true) => {
    const editor = editorRef.current;
    if (!editor || !bpDecos.current) return;
    const max = editor.getModel()!.getLineCount();
    bpDecos.current.set(
      [...new Set(lines)]
        .filter((l) => l >= 1 && l <= max)
        .map((line) => ({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            glyphMarginClassName: "bp-glyph",
            glyphMarginHoverMessage: { value: "Breakpoint (click to remove)" },
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        })),
    );
    if (notify) callbacks.current.onBreakpointsChange(breakpointLines());
  };

  const toggleBreakpoint = (line: number) => {
    const lines = new Set(breakpointLines());
    if (lines.has(line)) lines.delete(line);
    else lines.add(line);
    setBreakpoints([...lines]);
  };

  // Create the editor once.
  useEffect(() => {
    const editor = monaco.editor.create(hostRef.current!, {
      value: initialCode,
      language: "python",
      theme: "kiro-dark",
      automaticLayout: true,
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      fontSize: 14,
      lineHeight: 21,
      glyphMargin: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      renderLineHighlight: "all",
      padding: { top: 12 },
      tabSize: 4,
      insertSpaces: true,
      bracketPairColorization: { enabled: true },
      fixedOverflowWidgets: true,
    });
    editorRef.current = editor;
    bpDecos.current = editor.createDecorationsCollection();
    execDecos.current = editor.createDecorationsCollection();
    const hoverDecos = editor.createDecorationsCollection();
    setBreakpoints(initialBreakpoints, false);

    const GLYPH = monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;
    const subs = [
      editor.onMouseDown((e) => {
        if (e.target.type === GLYPH && e.target.position) toggleBreakpoint(e.target.position.lineNumber);
      }),
      editor.onMouseMove((e) => {
        if (e.target.type === GLYPH && e.target.position) {
          const line = e.target.position.lineNumber;
          hoverDecos.set([{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: "bp-hover-glyph" } }]);
        } else {
          hoverDecos.clear();
        }
      }),
      editor.onMouseLeave(() => hoverDecos.clear()),
      editor.onDidChangeModelContent(() => callbacks.current.onChange(editor.getValue())),
    ];
    editor.focus();
    return () => {
      subs.forEach((s) => s.dispose());
      editor.getModel()?.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    getValue: () => editorRef.current?.getValue() ?? "",
    setValue: (code: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.pushUndoStop();
      editor.executeEdits("sample", [{ range: editor.getModel()!.getFullModelRange(), text: code }]);
      editor.pushUndoStop();
    },
    getBreakpoints: breakpointLines,
    setBreakpoints: (lines: number[]) => setBreakpoints(lines),
    toggleBreakpointAtCursor: () => {
      const pos = editorRef.current?.getPosition();
      if (pos) toggleBreakpoint(pos.lineNumber);
    },
    flashLine: (line: number) => {
      const editor = editorRef.current;
      if (!editor || !line) return;
      const flash = editor.createDecorationsCollection([
        { range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: "line-flash" } },
      ]);
      setTimeout(() => flash.clear(), 2600);
    },
    focus: () => editorRef.current?.focus(),
  }));

  // Current-line decorations follow the `exec` prop.
  const execKey = JSON.stringify(exec);
  useEffect(() => {
    const editor = editorRef.current;
    const decos = execDecos.current;
    if (!editor || !decos) return;
    const model = editor.getModel()!;
    if (!exec || exec.line < 1 || exec.line > model.getLineCount()) {
      decos.clear();
      monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
      return;
    }
    const { line } = exec;
    const endCol = model.getLineMaxColumn(line);
    const list: monaco.editor.IModelDeltaDecoration[] = [
      {
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: exec.isError ? "error-line-bg" : "current-line-bg",
          glyphMarginClassName: exec.isError ? "error-glyph" : "current-glyph",
        },
      },
    ];
    if (exec.hint) {
      list.push({
        range: new monaco.Range(line, endCol, line, endCol),
        options: {
          showIfCollapsed: true, // required for injected text on an empty range
          after: {
            content: "   " + exec.hint.text,
            inlineClassName: exec.hint.alert ? "inline-hint-alert" : "inline-hint",
          },
        },
      });
    }
    decos.set(list);
    monaco.editor.setModelMarkers(
      model,
      MARKER_OWNER,
      exec.marker
        ? [
            {
              severity: monaco.MarkerSeverity.Error,
              message: exec.marker,
              startLineNumber: line,
              startColumn: model.getLineFirstNonWhitespaceColumn(line) || 1,
              endLineNumber: line,
              endColumn: endCol,
            },
          ]
        : [],
    );
    if (exec.reveal) editor.revealLineInCenterIfOutsideViewport(line, monaco.editor.ScrollType.Smooth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execKey]);

  return (
    <section className="pane editor-pane" aria-label="Code editor">
      <div className="pane-header">
        <span className="tab-title">main.py</span>
        {dirty && <span className="badge badge-warn">edited · re-run to update</span>}
        <span className="pane-hint">Click the gutter to add a breakpoint</span>
      </div>
      <div ref={hostRef} className="editor-host" />
    </section>
  );
}
