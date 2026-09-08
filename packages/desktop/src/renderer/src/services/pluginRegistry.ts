/**
 * PluginRegistry — renderer-side extension surface for plugins.
 *
 * While the engine (`@muyajs/core`) manages its own per-instance UI plugins
 * (toolbars, menus, selectors), the renderer has its own extension points:
 * the command palette and the sidebar. PluginRegistry is the single seam the
 * latter flow through.
 *
 * Plugins register contributions at module load time (side effect), the same
 * way `Muya.use()` registers engine plugins. The renderer's command center
 * store and sidebar component consume the registrations during their own
 * initialization — so the order is: plugin modules import → registries fill up
 → store/sidebar read them.
 *
 * This module is renderer-only (it touches Pinia stores and DOM components) and
 * is deliberately not re-exported from `@muyajs/core`, which stays environment-
 * agnostic. Engine plugins that also want to contribute to the renderer should
 * implement an optional `setupRendererExtensions(registry)` method that the
 * renderer calls after `Muya.init()`.
 */
import type { CommandDescriptor } from '../commands'
import type { Component } from 'vue'

/**
 * A sidebar panel contribution. The icon appears in the sidebar's left column;
 * the panel component renders in the right column when the icon is clicked.
 *
 * `position` controls ordering relative to built-in panels: 'top' sorts before
 * built-in icons, 'bottom' after (where the settings gear lives), and 'inline'
 * interleaves alphabetically by id. Default: 'inline'.
 */
export type SidebarPanelPosition = 'top' | 'inline' | 'bottom'

export interface SidebarPanelRegistration {
  /** Unique identifier, also used as the rightColumn value. */
  id: string
  /** Display name (tooltip + header). */
  name: string
  /** Icon component (e.g. an `<svg>` or an Element Plus icon). */
  icon: Component
  /** The Vue component rendered in the sidebar's right column. */
  component: Component
  /** Sort position relative to built-in panels. Default: 'inline'. */
  position?: SidebarPanelPosition
}

type Unregister = () => void

// ---------------------------------------------------------------------------
// Internal registries (module singletons)
// ---------------------------------------------------------------------------

const commandRegistrations = new Map<string, CommandDescriptor>()
const sidebarRegistrations = new Map<string, SidebarPanelRegistration>()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a command that appears in the command palette.
 *
 * Call this at module load time (same pattern as `Muya.use()`). The command
 * surfaces in the palette alongside built-in commands and is merged into the
 * root command list when the command center store initializes.
 *
 * @returns An unregister function that removes the command.
 */
export function registerCommand(command: CommandDescriptor): Unregister {
  commandRegistrations.set(command.id, command)
  return () => {
    commandRegistrations.delete(command.id)
  }
}

/**
 * Register a sidebar panel.
 *
 * The icon appears in the sidebar's left column; the component renders in the
 * right column. Call this at module load time.
 *
 * @returns An unregister function that removes the panel.
 */
export function registerSidebarPanel(panel: SidebarPanelRegistration): Unregister {
  sidebarRegistrations.set(panel.id, panel)
  return () => {
    sidebarRegistrations.delete(panel.id)
  }
}

/**
 * Snapshot the currently registered commands for consumption by the command
 * center store. The store calls this once at initialization; subsequent
 * registrations are NOT automatically reflected (the renderer is not reactive
 * to dynamic plugin loading in v1 — extensions load at startup).
 *
 * Returns a shallow copy so the caller can mutate (sort, filter) without
 * touching the registry.
 */
export function getRegisteredCommands(): CommandDescriptor[] {
  return [...commandRegistrations.values()]
}

/**
 * Snapshot the currently registered sidebar panels. The sidebar calls this once
 * at mount time.
 */
export function getRegisteredSidebarPanels(): SidebarPanelRegistration[] {
  return [...sidebarRegistrations.values()]
}

/**
 * Clear all registrations. Exposed for testing — production code never calls
 * this. Kept out of the default export surface to avoid accidental use.
 */
export function _clearRegistryForTests(): void {
  commandRegistrations.clear()
  sidebarRegistrations.clear()
}
