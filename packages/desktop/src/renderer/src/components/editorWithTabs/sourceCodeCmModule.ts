// PERF-01 (#GUI-B5): the CodeMirror module (runtime + addons + themes) loads
// on the first source-code-mode mount and lives in its own async chunk. The
// holder is a separate injectable unit so the sfcScriptHarness specs can stub
// it and keep asserting the cursor-fallback behavior through the real
// component code (see AGENTS.md on the harness's hand-written dep lists).
//
// The type is structural instead of `typeof import('../../codeMirror')`:
// @typescript-eslint/consistent-type-imports (disallowTypeAnnotations) forbids
// import() type annotations outright.
interface CodeMirrorModule {
  default: (container: HTMLElement, config: Record<string, unknown>) => unknown
  setCursorAtFirstLine: (editor: unknown) => void
  setTextDirection: (editor: unknown, dir: string) => void
  [key: string]: unknown
}

let mod: CodeMirrorModule | null = null

export const getCodeMirrorModule = (): CodeMirrorModule | null => mod

export const loadCodeMirrorModule = async (): Promise<CodeMirrorModule> => {
  mod ??= (await import('../../codeMirror')) as CodeMirrorModule
  return mod
}

export const setCodeMirrorModule = (next: CodeMirrorModule | null): void => {
  mod = next
}
