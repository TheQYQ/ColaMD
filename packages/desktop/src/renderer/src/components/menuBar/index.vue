<template>
  <div
    v-if="visible"
    class="menu-bar"
  >
    <div
      v-for="(menu, i) in menus"
      :key="menu.id"
      class="menu-item title-no-drag"
      :class="{ open: openIndex === i }"
      @click.stop="toggleMenu(i, $event)"
      @mouseenter="hoverMenu(i, $event)"
    >
      {{ menu.label }}
    </div>
  </div>
  <teleport to="body">
    <div
      v-if="openIndex !== null"
      class="menu-dropdown root-dropdown title-no-drag"
      :style="dropdownStyle"
    >
      <menu-list
        :items="openItems"
        @action="closeAll"
        @close="closeAll"
      />
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { usePreferencesStore } from '@/store/preferences'
import { isOsx } from '@/util'
import { buildMenus } from '@/menu/menus'
import MenuList from './MenuList.vue'
import type { MenuItemDef } from '@/menu/types'

/**
 * Typora-style in-window menu bar for frameless windows (custom title bar on
 * Windows/Linux); macOS keeps its native menu bar. Dropdowns are fully drawn
 * (menus/menus.ts) and dispatch through the renderer command center / bus /
 * IPC — the same action chains the native menu uses.
 */
const preferencesStore = usePreferencesStore()
const { titleBarStyle } = storeToRefs(preferencesStore)

const MENU_BAR_HEIGHT = '28px'

const visible = computed(() => titleBarStyle.value === 'custom' && !isOsx)

// Recently used documents are main-process state, fetched when the File menu
// opens (and after clearing) via `mt::menu::get-recent-documents`.
const recentFiles = ref<string[]>([])

const menus = computed(() => buildMenus(recentFiles.value))

const openIndex = ref<number | null>(null)
const openItems = ref<MenuItemDef[]>([])
const dropdownStyle = ref<Record<string, string>>({})

const openMenu = async(index: number, anchor?: HTMLElement): Promise<void> => {
  const menu = menus.value[index]
  if (!menu) return
  const el =
    anchor ??
    (document.querySelector('.menu-bar')?.children[index] as HTMLElement | undefined)
  if (el) {
    const rect = el.getBoundingClientRect()
    const estimatedWidth = 260
    const left = Math.max(
      4,
      Math.min(rect.left, window.innerWidth - estimatedWidth - 8)
    )
    dropdownStyle.value = {
      left: `${left}px`,
      top: `${Math.round(rect.bottom) + 1}px`
    }
  }
  if (menu.id === 'file') {
    await fetchRecentFiles()
  }
  openIndex.value = index
  openItems.value = menu.items()
}

const toggleMenu = (index: number, event: MouseEvent): void => {
  if (openIndex.value === index) {
    closeAll()
    return
  }
  void openMenu(index, event.currentTarget as HTMLElement)
}

const hoverMenu = (index: number, event: MouseEvent): void => {
  if (openIndex.value === null || openIndex.value === index) return
  void openMenu(index, event.currentTarget as HTMLElement)
}

const closeAll = (): void => {
  openIndex.value = null
  openItems.value = []
}

const fetchRecentFiles = async(): Promise<void> => {
  try {
    const list = await window.electron.ipcRenderer.invoke('mt::menu::get-recent-documents')
    recentFiles.value = Array.isArray(list) ? (list as string[]) : []
  } catch {
    recentFiles.value = []
  }
}

const onDocumentMouseDown = (event: MouseEvent): void => {
  const target = event.target as HTMLElement | null
  if (!target) return
  if (target.closest('.menu-bar') || target.closest('.menu-dropdown')) return
  closeAll()
}

const onKeyDown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' && openIndex.value !== null) {
    closeAll()
    return
  }
  if (openIndex.value === null) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const delta = event.key === 'ArrowLeft' ? -1 : 1
    const next = (openIndex.value + delta + menus.value.length) % menus.value.length
    void openMenu(next)
    event.preventDefault()
  }
}

watch(visible, (value) => {
  document.documentElement.style.setProperty('--menuBarHeight', value ? MENU_BAR_HEIGHT : '0px')
  if (!value) closeAll()
})

onMounted(() => {
  if (visible.value) {
    document.documentElement.style.setProperty('--menuBarHeight', MENU_BAR_HEIGHT)
  }
  document.addEventListener('mousedown', onDocumentMouseDown, true)
  document.addEventListener('keydown', onKeyDown, true)
})

onBeforeUnmount(() => {
  document.documentElement.style.setProperty('--menuBarHeight', '0px')
  document.removeEventListener('mousedown', onDocumentMouseDown, true)
  document.removeEventListener('keydown', onKeyDown, true)
})
</script>

<style scoped>
.menu-bar {
  -webkit-app-region: drag;
  user-select: none;
  height: var(--menuBarHeight, 0px);
  display: flex;
  align-items: stretch;
  padding: 0 4px;
  box-sizing: border-box;
  /* Same background as the editor and the title-bar spacer — transparent
     would let the (white) page background bleed through on dark themes. */
  background: var(--editorBgColor);
  color: var(--editorColor50);
  font-size: 12px;
  overflow: hidden;
}
.menu-item {
  display: flex;
  align-items: center;
  padding: 0 9px;
  border-radius: 3px;
  cursor: default;
  white-space: nowrap;
  /* Own no-drag declaration: the shared `title-no-drag` class is scoped to
     the titleBar component and does not apply here. */
  -webkit-app-region: no-drag;
}
.menu-item:hover,
.menu-item.open {
  background: var(--floatHoverColor);
  color: var(--editorColor80);
}
</style>

<style>
/* Dropdown panels are teleported to <body>; global (non-scoped) styles. */
.menu-dropdown {
  position: fixed;
  z-index: 10000;
  min-width: 230px;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  overflow-x: visible;
  background: var(--floatBgColor);
  border: 1px solid var(--floatBorderColor);
  border-radius: 6px;
  box-shadow: var(--floatShadow);
  padding: 4px 0;
  box-sizing: border-box;
  font-size: 13px;
  color: var(--floatFontColor);
  -webkit-app-region: no-drag;
}
.menu-dropdown.submenu {
  max-height: calc(100vh - 100px);
}
</style>
