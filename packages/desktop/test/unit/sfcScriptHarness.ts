// Two desktop specs (`search-prefill.spec.ts`, `source-code-image-action.spec.ts`)
// run the real `<script setup>` of an SFC by compiling it, removing its imports,
// and evaluating it with a hand-written dependency object injected via
// `new Function`. The removal step is the fragile part: a line-based filter
// (`!/^\s*import\s/`) deletes only the FIRST line of a multi-line import, and the
// leftovers (`  findMarkdownHeadingLine,` …) then parse as an expression
// statement -- which throws `ReferenceError` for every symbol in the list, so the
// whole spec dies at load, not at one assertion.
//
// This bit for real: a commit that touched nothing but one expression inside
// `sourceCode.vue` got the file reformatted by the pre-commit hook, and the
// single-line `import { a, b, c } from '…'` became a four-line one.
//
// So strip by statement, tracking the brace depth of `import { … } from '…'`.

const braceDelta = (line: string): number => {
  const opened = line.match(/\{/g)?.length ?? 0
  const closed = line.match(/\}/g)?.length ?? 0
  return opened - closed
}

export const stripTopLevelImports = (code: string): string => {
  const kept: string[] = []
  let depth = 0
  for (const line of code.split('\n')) {
    const startsImport = depth === 0 && /^\s*import\s/.test(line)
    if (startsImport || depth > 0) {
      // Consumed: a one-liner nets to 0 here and the next line is kept normally.
      depth += braceDelta(line)
      if (depth < 0) depth = 0
      continue
    }
    kept.push(line)
  }
  return kept.join('\n')
}
