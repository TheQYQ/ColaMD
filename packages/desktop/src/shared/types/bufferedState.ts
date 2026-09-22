// Buffered editor state (persisted across window close/reopen).

import type { IFileState } from './files'

interface BufferedEditorState {
  tabs: IFileState[]
  currentFileId?: string
  [key: string]: unknown
}

interface BufferedProjectState {
  [key: string]: unknown
}

interface BufferedLayoutState {
  [key: string]: unknown
}

export interface BufferedState {
  editor?: BufferedEditorState
  project?: BufferedProjectState
  layout?: BufferedLayoutState
  [key: string]: unknown
}
