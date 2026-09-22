import notice from '../services/notification'

/**
 * The two feedback shapes every sidebar command reaches for: a refusal the user
 * has to read, and a caught error whose message IS the whole payload. They live
 * here because the commands are split across modules (context menu, paste) and
 * the `err instanceof Error` guard is not something to re-derive per call site.
 */
export const sidebarWarn = (title: string, message: string): void => {
  notice.notify({ title, type: 'warning', message })
}

export const sidebarFail = (title: string, err: unknown): void => {
  notice.notify({
    title,
    type: 'error',
    message: err instanceof Error ? err.message : String(err)
  })
}
