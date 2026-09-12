<template>
  <div
    v-show="showSideBar"
    ref="sideBar"
    class="side-bar"
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
          :opened-files="openedFiles"
          :tabs="tabs"
        />
        <side-bar-search v-else-if="activeColumn === 'search'" />
        <toc v-else-if="activeColumn === 'toc'" />
        <history v-else-if="activeColumn === 'history'" />
        <component
          :is="getSidebarPanel(activeColumn)?.component"
          v-else-if="getSidebarPanel(activeColumn)"
        />
      </div>
    </div>
    <div
      ref="dragBar"
      class="drag-bar"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useLayoutStore } from '@/store/layout'
import { useProjectStore } from '@/store/project'
import { useEditorStore } from '@/store/editor'

import { getAllSideBarTabs, getSidebarPanel } from './help'
import Tree from './tree.vue'
import SideBarSearch from './search.vue'
import Toc from './toc.vue'
import History from './history.vue'
import { storeToRefs } from 'pinia'
import type { TabDescriptor } from './types'

/**
 * Typora-style sidebar: a single clean panel with a text tab row on top.
 * There is no icon strip and no settings gear (preferences live in the
 * 文件 > 偏好设置 menu). Clicking the active tab closes the sidebar; clicking
 * another tab switches panels.
 */
const layoutStore = useLayoutStore()
const projectStore = useProjectStore()
const editorStore = useEditorStore()

const sideBar = ref<HTMLDivElement | null>(null)
const dragBar = ref<HTMLDivElement | null>(null)

const openedFiles = ref<TabDescriptor[]>([])
const sideBarViewWidth = ref(280)

const { rightColumn, showSideBar, sideBarWidth } = storeToRefs(layoutStore)

const { projectTree } = storeToRefs(projectStore)
const { tabs } = storeToRefs(editorStore)

const sideBarTabList = getAllSideBarTabs()

// External IPC can set `rightColumn` to '' (the old "collapsed to icon strip"
// state); with the strip gone, fall back to the files panel instead of
// rendering an empty sidebar.
const activeColumn = computed<string>(() => rightColumn.value || 'files')

const finalSideBarWidth = computed<number>(() => {
  if (!showSideBar.value) return 0
  return sideBarViewWidth.value < 220 ? 220 : sideBarViewWidth.value
})

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
      layoutStore.CHANGE_SIDE_BAR_WIDTH(currentSideBarWidth < 220 ? 220 : currentSideBarWidth)
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
  border-right: 1px solid var(--itemBgColor);
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
  padding: 2px 14px 0;
  box-sizing: border-box;
}

.side-bar-tab {
  flex: 1;
  appearance: none;
  border: none;
  background: transparent;
  color: var(--sideBarColor);
  font-size: 13px;
  line-height: 1;
  text-align: center;
  padding: 10px 0 11px;
  cursor: pointer;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
  border-radius: 0;
}

.side-bar-tab:hover {
  color: var(--sideBarTitleColor);
}

.side-bar-tab.active {
  color: var(--sideBarTitleColor);
  font-weight: 600;
  border-bottom-color: var(--sideBarTitleColor);
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
