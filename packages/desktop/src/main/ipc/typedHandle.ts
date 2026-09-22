import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcInvokeChannels } from '@shared/types/ipc'

type Handler<K extends keyof IpcInvokeChannels> = (
  event: IpcMainInvokeEvent,
  ...args: IpcInvokeChannels[K]['args']
) => IpcInvokeChannels[K]['ret'] | Promise<IpcInvokeChannels[K]['ret']>

/**
 * Registers a main-process `invoke` handler through the shared contract.
 *
 * `shared/types/ipc.ts` already types the preload side of every channel, but a
 * plain `ipcMain.handle('mt::…', …)` is unchecked: Electron gives its listener
 * `any[]`, so the two ends of a channel can drift apart and only fail at run
 * time. Wrapping the registration makes the channel name, its argument tuple
 * and its return type compile-time facts on both sides.
 */
export const typedHandle = <K extends keyof IpcInvokeChannels>(
  channel: K,
  handler: Handler<K>
): void => {
  // eslint-disable-next-line no-restricted-syntax -- this is the wrapper the rule points at
  ipcMain.handle(channel, handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown)
}
