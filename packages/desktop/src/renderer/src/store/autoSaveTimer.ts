// Pending auto-save timers, keyed by tab id. The map has its own module because
// the tab-close path disarms a timer for a tab that is going away while the
// content-change and disk-change paths arm and re-arm it — both ends have to see
// one map, and a stale timer would write content the user has moved past.
export const autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const clearAutoSaveTimer = (id: string | undefined): void => {
  if (!id) return
  const timer = autoSaveTimers.get(id)
  if (timer !== undefined) clearTimeout(timer)
  autoSaveTimers.delete(id)
}
