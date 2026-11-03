<template>
  <div
    v-show="showSideBar"
    ref="sideBar"
    class="side-bar"
    :class="{ 'side-bar-overlay': sideBarOverlay }"
    :style="{ width: `${finalSideBarWidth}px` }"
  >
    <div class="side-bar-inner">
      <div class="side-bar-tabs">
        <button
          v-for="c of sideBarTabList"
          :key="c.id"
          class="side-bar-tab"
          :class="{ active: c.id === activeColumn }"
          @click="handleTabClick(c.id)"
        >
          {{ c.name() }}
        </button>
      </div>
      <div class="side-panel">
        <tree
          v-if="activeColumn === 'files'"
          :project-tree="projectTree"
        />
        <toc v-else-if="activeColumn === 'toc'" />
        <history v-else-if="activeColumn === 'history'" />
      </div>
    </div>
    <div
      ref="dragBar"
      class="drag-bar"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      :aria-label="t('sideBar.resizeHandle')"
      :aria-valuemin="SIDE_BAR_MIN_WIDTH"
      :aria-valuemax="ariaValueMax"
      :aria-valuenow="finalSideBarWidth"
      @keydown="handleDragBarKeydown"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useLayoutStore } from '@/store/layout'
import { useProjectStore } from '@/store/project'
import { usePreferencesStore } from '@/store/preferences'

import { useI18n } from 'vue-i18n'
import { getAllSideBarTabs } from './help'
import Tree from './tree.vue'
import Toc from './toc.vue'
import History from './history.vue'
import { storeToRefs } from 'pinia'

/**
 * Typora-style sidebar: a single clean panel with a text tab row on top.
 * There is no icon strip and no settings gear (preferences live in the
 * 文件 > 偏好设置 menu). Clicking the active tab closes the sidebar; clicking
 * another tab switches panels.
 */
const { t } = useI18n()
const layoutStore = useLayoutStore()
const projectStore = useProjectStore()
const { sideBarOverlay } = storeToRefs(usePreferencesStore())

const sideBar = ref<HTMLDivElement | null>(null)
const dragBar = ref<HTMLDivElement | null>(null)

const sideBarViewWidth = ref(280)

const { rightColumn, showSideBar, sideBarWidth } = storeToRefs(layoutStore)

const { projectTree } = storeToRefs(projectStore)

const sideBarTabList = getAllSideBarTabs()

// External IPC can set `rightColumn` to '' (the old "collapsed to icon strip"
// state); with the strip gone, fall back to the files panel instead of
// rendering an empty sidebar.
const activeColumn = computed<string>(() => rightColumn.value || 'files')

const SIDE_BAR_MIN_WIDTH = 220
const SIDE_BAR_KEYBOARD_STEP = 16
const SIDE_BAR_KEYBOARD_LARGE_STEP = 64

const finalSideBarWidth = computed<number>(() => {
  if (!showSideBar.value) return 0
  return sideBarViewWidth.value < SIDE_BAR_MIN_WIDTH ? SIDE_BAR_MIN_WIDTH : sideBarViewWidth.value
})

// Keyboard resizing (A11Y-12): the drag strip is also a focusable separator
// (WAI-ARIA window splitter), so it must expose a range. The upper bound keeps
// at least 320 px for the editor and never falls below the current width — a
// width set by mouse dragging must stay inside the announced range.
const keyboardMaxWidth = computed<number>(() =>
  Math.max(SIDE_BAR_MIN_WIDTH, window.innerWidth - 320)
)
const ariaValueMax = computed<number>(() =>
  Math.max(keyboardMaxWidth.value, finalSideBarWidth.value)
)

const handleDragBarKeydown = (event: KeyboardEvent): void => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  const step = event.shiftKey ? SIDE_BAR_KEYBOARD_LARGE_STEP : SIDE_BAR_KEYBOARD_STEP
  const delta = event.key === 'ArrowRight' ? step : -step
  const nextWidth = Math.min(
    keyboardMaxWidth.value,
    Math.max(SIDE_BAR_MIN_WIDTH, finalSideBarWidth.value + delta)
  )
  sideBarViewWidth.value = nextWidth
  layoutStore.CHANGE_SIDE_BAR_WIDTH(nextWidth)
  event.preventDefault()
}

onMounted(() => {
  nextTick(() => {
    const dragBarEl = dragBar.value
    if (!dragBarEl) return
    let startX = 0
    let currentSideBarWidth = +sideBarWidth.value
    let startWidth = currentSideBarWidth

    sideBarViewWidth.value = currentSideBarWidth

    const mouseUpHandler = (): void => {
      document.removeEventListener('mousemove', mouseMoveHandler, false)
      document.removeEventListener('mouseup', mouseUpHandler, false)
      layoutStore.CHANGE_SIDE_BAR_WIDTH(
        currentSideBarWidth < SIDE_BAR_MIN_WIDTH ? SIDE_BAR_MIN_WIDTH : currentSideBarWidth
      )
    }

    const mouseMoveHandler = (event: MouseEvent): void => {
      const offset = event.clientX - startX
      currentSideBarWidth = startWidth + offset
      sideBarViewWidth.value = currentSideBarWidth
    }

    const mouseDownHandler = (event: MouseEvent): void => {
      startX = event.clientX
      startWidth = +sideBarWidth.value
      document.addEventListener('mousemove', mouseMoveHandler, false)
      document.addEventListener('mouseup', mouseUpHandler, false)
    }

    dragBarEl.addEventListener('mousedown', mouseDownHandler, false)
  })
})

const handleTabClick = (name: string): void => {
  if (activeColumn.value === name) {
    // Clicking the active tab closes the sidebar (Typora behavior). The user's
    // width lives in the store already, so no width bookkeeping is needed.
    layoutStore.SET_LAYOUT({ showSideBar: false })
  } else {
    layoutStore.SET_LAYOUT({ rightColumn: name, showSideBar: true })
    sideBarViewWidth.value = +sideBarWidth.value
  }
}
</script>

<style scoped>
.side-bar.side-bar-overlay {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 20;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.side-bar {
  display: flex;
  flex-shrink: 0;
  flex-grow: 0;
  width: 280px;
  height: 100%;
  box-sizing: border-box;
  position: relative;
  color: var(--sideBarColor);
  user-select: none;
  background: var(--sideBarBgColor);
  border-right: 1px solid var(--border-subtle);
  font-family: var(--font-ui);
  /* V1 guide §四: sidebar collapse/expand animates width 240ms with ease-out-expo-ish curve. */
  transition: width 240ms cubic-bezier(0.4, 0, 0.2, 1);
}

.side-bar-inner {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: 100%;
}

.side-bar-tabs {
  flex: none;
  display: flex;
  align-items: stretch;
  margin: 12px 12px 8px;
  padding: 2px;
  box-sizing: border-box;
  background: var(--bg-hover);
  border-radius: 6px;
}

.side-bar-tab {
  flex: 1;
  appearance: none;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  text-align: center;
  padding: 7px 0;
  cursor: pointer;
  white-space: nowrap;
  border-radius: 4px;
  transition:
    color 120ms ease-out,
    background-color 120ms ease-out;
}

.side-bar-tab:hover {
  color: var(--text-primary);
}

.side-bar-tab.active {
  color: var(--text-primary);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-sm);
}

.side-panel {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.drag-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 3px;
  cursor: col-resize;
}

.drag-bar:hover {
  border-right: 2px solid var(--iconColor);
}
</style>
