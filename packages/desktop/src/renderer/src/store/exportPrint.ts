import bus from '../bus'
import notice from '../services/notification'
import { t } from '../i18n'
import type { ExportType, PageOptions } from '@shared/types/files'
import type { IpcSendChannels } from '@shared/types/ipc'
import type { useEditorStore } from './editor'

type EditorStore = ReturnType<typeof useEditorStore>

// O12(20) — the export/print cluster, moved out of the `actions` object in
// `editor.ts` verbatim (the store keeps one-line delegations). Two things did
// change on the way out, both pinned by
// `test/unit/specs/export-print-actions.spec.ts`:
//   - the request is typed against the shared `mt::response-export` contract
//     instead of going out through `as ExportPayload['type'] as never`;
//   - dismissing the "exported" toast no longer rejects an unhandled promise,
//     which the renderer's global `unhandledrejection` handler turned into an
//     error report. Revealing the file stays a deliberate click.

export interface ExportPayload {
  type: string
  /** Which document this export is FOR, frozen when the request starts. */
  source: ExportSource | null
  content?: string
  /** Binary export payloads (e.g. .docx bytes) — written as-is by main. */
  bytes?: Uint8Array
  /** Raw markdown source — used by the pandoc export formats. */
  markdown?: string
  pageOptions?: PageOptions
}

/**
 * The identity an exported file is named after: the open document's own name,
 * path, and outline-derived title. It travels with the request because an
 * export awaits (the whole document is rendered, and the save dialog is native);
 * reading `currentFile` afterwards would name document A's bytes after document
 * B whenever the user switched tabs while A was rendering.
 */
export interface ExportSource {
  filename: string
  pathname: string
  title: string
}

export const captureExportSource = (store: EditorStore): ExportSource | null => {
  const currentFile = store.currentFile
  if (!currentFile) return null
  const { filename, pathname } = currentFile
  return { filename, pathname, title: exportTitle(store.listToc) }
}

/**
 * The heading an export gets titled after: the shallowest of the first six TOC
 * entries, stopping early once a top-level heading is in hand. Deeper entries
 * are out of reach by design — a long document's outline starts with its title.
 */
const exportTitle = (listToc: EditorStore['listToc']): string => {
  if (!listToc || listToc.length === 0) return ''
  let headerRef: EditorStore['listToc'][number] | undefined = listToc[0]
  const len = Math.min(listToc.length, 6)
  for (let i = 1; i < len; ++i) {
    if (headerRef?.lvl === 1) break
    const header = listToc[i]
    if (header && headerRef && (headerRef.lvl ?? 0) > (header.lvl ?? 0)) {
      headerRef = header
    }
  }
  return headerRef?.content ?? ''
}

export const sendExportResponse = (payload: ExportPayload): void => {
  const { source } = payload
  // No source means the caller did not say which document this is. Exporting
  // whatever happens to be focused now is exactly the confusion this prevents.
  if (!source) return

  const { type, content, bytes, markdown, pageOptions } = payload
  // `type` is the literal the export menu handed down; the renderer carries it
  // as `string` because it arrives off the bus untyped.
  const request: IpcSendChannels['mt::response-export'][0] = {
    type: type as ExportType,
    title: source.title,
    content: content ?? '',
    bytes,
    markdown: markdown ?? '',
    filename: source.filename,
    pathname: source.pathname,
    pageOptions: pageOptions ?? {}
  }
  window.electron.ipcRenderer.send('mt::response-export', request)
}

export const listenForExportSuccess = (): void => {
  window.electron.ipcRenderer.on('mt::export-success', (_, payload) => {
    const filePath = payload?.filePath ?? ''
    notice
      .notify({
        title: t('store.editor.exportSuccessTitle'),
        message: t('store.editor.exportSuccessMessage', {
          name: window.path.basename(filePath)
        }),
        showConfirm: true
      })
      .then(() => {
        window.electron.shell.showItemInFolder(filePath)
      })
      .catch(() => {
        // The toast was dismissed: the export still succeeded, there is just
        // nothing left to reveal.
      })
  })
}

export const sendPrintResponse = (): void => {
  window.electron.ipcRenderer.send('mt::response-print')
}

export const listenForPrintServiceClearup = (): void => {
  window.electron.ipcRenderer.on('mt::print-service-clearup', () => {
    bus.emit('print-service-clearup')
  })
}
