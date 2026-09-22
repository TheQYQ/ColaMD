import { ipcMain, type IpcMainEvent } from 'electron'
import type { IpcSendChannels, IpcSyncChannels } from '@shared/types/ipc'

type Listener<K extends keyof IpcSendChannels> = (
  event: IpcMainEvent,
  ...args: IpcSendChannels[K]
) => void

type SyncListener<K extends keyof IpcSyncChannels> = (
  event: IpcMainEvent,
  ...args: IpcSyncChannels[K]['args']
) => void

/**
 * Registers a main-process listener for a fire-and-forget channel through the
 * shared contract.
 *
 * Electron hands an `ipcMain.on` listener `any[]`, so a bare registration
 * checks nothing: the channel name, the sender's argument tuple and the
 * handler's parameter list could all drift and only disagree at run time. The
 * contract in `shared/types/ipc.ts` already types the preload side of every
 * channel, so wrapping the registration is what makes the two ends agree at
 * compile time. `typedHandle` does the same for `invoke`.
 */
export const typedOn = <K extends keyof IpcSendChannels>(
  channel: K,
  listener: Listener<K>
): void => {
  // eslint-disable-next-line no-restricted-syntax -- this is the wrapper the rule points at
  ipcMain.on(channel, listener as (event: IpcMainEvent, ...args: unknown[]) => void)
}

/**
 * The synchronous siblings (`event.returnValue = …`). They are registered with
 * `ipcMain.on` like any fire-and-forget channel but their payloads live in
 * `IpcSyncChannels`, so they get their own wrapper instead of an exemption --
 * which keeps the lint ban on bare `ipcMain.on` free of exceptions.
 */
export const typedSyncOn = <K extends keyof IpcSyncChannels>(
  channel: K,
  listener: SyncListener<K>
): void => {
  // eslint-disable-next-line no-restricted-syntax -- this is the wrapper the rule points at
  ipcMain.on(channel, listener as (event: IpcMainEvent, ...args: unknown[]) => void)
}
