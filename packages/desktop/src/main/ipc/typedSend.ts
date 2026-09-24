import type { WebContents } from 'electron'
import type { IpcMainEventChannels } from '@shared/types/ipc'

/**
 * Push an event to a renderer through the shared contract.
 *
 * `webContents.send('mt::…', payload)` is unchecked on the emitter side: the
 * payload is `...any[]`, so a channel can be renamed or its payload reshaped
 * and only disagree in the renderer at run time. Binding the call to
 * `IpcMainEventChannels` makes both the channel name and the argument tuple
 * compile-time facts, the same way `typedHandle` and `typedOn` do for the other
 * two directions.
 *
 * The target is nullable on purpose: a dozen call sites read
 * `browserWindow?.webContents.send(…)`, where an absent window already short
 * circuits. Taking `WebContents | null | undefined` here keeps that behaviour
 * identical -- and says out loud that pushing to a window that is gone is the
 * normal case, not an error.
 */
export const typedSend = <K extends keyof IpcMainEventChannels>(
  target: WebContents | null | undefined,
  channel: K,
  ...args: IpcMainEventChannels[K]
): void => {
  if (!target) return
  target.send(channel, ...args)
}
