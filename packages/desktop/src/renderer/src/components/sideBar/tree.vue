<template>
  <div class="tree-view">
    <!-- Project tree view -->
    <div
      v-if="projectTree"
      class="project-tree"
    >
      <div
        class="title"
        @contextmenu.prevent="handleRootContextMenu"
      >
        <el-icon
          class="icon-arrow"
          :class="{ fold: !showDirectories }"
          :size="12"
          @click.stop="toggleDirectories()"
        >
          <ArrowRight />
        </el-icon>
        <span
          class="default-cursor text-overflow"
          @click.stop="toggleDirectories()"
        >{{
          projectTree.name
        }}</span>
      </div>
      <div
        v-show="showDirectories"
        ref="treeWrapper"
        class="tree-wrapper"
        tabindex="0"
        @keydown="handleTreeKeydown"
        @click="handleWrapperClick"
      >
        <folder
          v-for="folder of projectTree.folders"
          :key="folder.id"
          :folder="folder"
          :depth="depth"
        />
        <input
          v-show="createCacheDirname === projectTree.pathname"
          ref="input"
          v-model="createName"
          placeholder="Enter .md file name"
          type="text"
          class="new-input"
          :style="{ 'padding-left': `${depth * 6 + 10}px` }"
          @keydown.enter="handleInputEnter"
        >
        <file
          v-for="file of projectTree.files"
          :key="file.id"
          :file="file"
          :depth="depth"
        />
        <div
          v-if="
            projectTree.files.length === 0 &&
              projectTree.folders.length === 0 &&
              createCacheDirname !== projectTree.pathname
          "
          class="empty-project"
        >
          <span>{{ t('sideBar.tree.emptyProject') }}</span>
          <div class="centered-group">
            <button
              class="button-primary"
              @click.stop="createFile"
            >
              {{ t('sideBar.tree.createFile') }}
            </button>
          </div>
        </div>
      </div>
    </div>
    <div
      v-else
      class="open-project"
    >
      <div class="centered-group">
        <el-button
          text
          bg
          type="primary"
          @click="openFile"
        >
          {{ t('sideBar.tree.openFile') }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, provide } from 'vue'
import { storeToRefs } from 'pinia'
import { useProjectStore } from '@/store/project'
import Folder from './treeFolder.vue'
import File from './treeFile.vue'
import bus from '../../bus'
import { showContextMenu } from '../../contextMenu/sideBar'
import { useI18n } from 'vue-i18n'
import { ArrowRight } from '@element-plus/icons-vue'
import { nextTreeNavState, type TreeNavKey, type TreeRowModel } from './treeKeyboard'
import type { TreeNode } from './types'

const { t } = useI18n()

const props = defineProps<{
  // The project store seeds `projectTree` as `null` until a folder is
  // opened; the template renders the "open project" empty-state behind
  // `v-if="projectTree"`. Type the prop nullable to match runtime + the
  // template guard.
  projectTree: TreeNode | null
}>()

const depth = 0
// The tree is rendered under a v-if and is destroyed when the sidebar
// collapses, so local refs reset to expanded on re-open. Back them with
// localStorage so the state survives a re-mount and app restart.
const SHOW_DIRECTORIES_KEY = 'side-bar-show-directories'
const readSectionExpanded = (key: string): boolean => localStorage.getItem(key) !== 'false'
const showDirectories = ref(readSectionExpanded(SHOW_DIRECTORIES_KEY))
const createName = ref('')
const input = ref<HTMLInputElement | null>(null)

const projectStore = useProjectStore()

// Computed properties
const { createCache } = storeToRefs(projectStore)
const { clipboard } = storeToRefs(projectStore)

// The createCache state is `{ dirname, type }` while an input is shown, and
// `{}` otherwise. Expose a typed accessor for the template so we don't have
// to thread `as any` through every comparison.
const createCacheDirname = computed<string | undefined>(() => {
  const cache = createCache.value as { dirname?: string }
  return cache.dirname
})

// Methods
const openFile = (): void => {
  projectStore.ASK_FOR_OPEN_FILE()
}

const createFile = (): void => {
  projectStore.CHANGE_ACTIVE_ITEM(props.projectTree)
  bus.emit('SIDEBAR::new', 'file')
}

const handleRootContextMenu = (event: MouseEvent): void => {
  projectStore.CHANGE_ACTIVE_ITEM(props.projectTree)
  showContextMenu(event, !!clipboard.value)
}

const toggleDirectories = (): void => {
  showDirectories.value = !showDirectories.value
  localStorage.setItem(SHOW_DIRECTORIES_KEY, String(showDirectories.value))
}

// From createFileOrDirectoryMixins
const handleInputFocus = (): void => {
  nextTick(() => {
    if (input.value) {
      input.value.focus()
      createName.value = ''
    }
  })
}

const handleInputEnter = (): void => {
  projectStore.CREATE_FILE_DIRECTORY(createName.value)
}

// ---------------------------------------------------------------------------
// Keyboard navigation (Typora 1.14 parity). The reducer in treeKeyboard.ts
// owns the traversal rules; this block is the DOM glue: rows expose their
// identity through data-* attributes, the wrapper gathers them in visual
// order, and mouse clicks on rows sync the keyboard focus so the two
// selection models never disagree.
// ---------------------------------------------------------------------------
const treeWrapper = ref<HTMLDivElement | null>(null)
const kbFocusedPathname = ref<string | null>(null)
provide('sideBarTreeKbFocus', kbFocusedPathname)

const NAV_KEYS: TreeNavKey[] = [
  'ArrowDown',
  'ArrowUp',
  'ArrowRight',
  'ArrowLeft',
  'Home',
  'End',
  'Enter',
  'F2',
  'Delete'
]

const gatherRows = (): { rows: TreeRowModel[]; els: HTMLElement[] } => {
  const els = Array.from(treeWrapper.value?.querySelectorAll<HTMLElement>('[data-tree-row]') ?? [])
  const rows: TreeRowModel[] = els.map((el) => ({
    pathname: el.dataset.pathname ?? '',
    kind: el.dataset.kind === 'folder' ? 'folder' : 'file',
    depth: Number(el.dataset.depth ?? 0),
    expanded: el.dataset.expanded === 'true'
  }))
  return { rows, els }
}

// The sidebar context handlers read only { pathname, isDirectory } off the
// active item (sidebarContextMenu.ts), so a minimal node reconstructed from
// the row dataset is enough for F2 / Delete — no store lookup needed.
const nodeFromRow = (el: HTMLElement): unknown => {
  const pathname = el.dataset.pathname ?? ''
  const isDirectory = el.dataset.kind === 'folder'
  return {
    pathname,
    isDirectory,
    isFile: !isDirectory,
    isMarkdown: el.dataset.markdown === 'true',
    name: window.path.basename(pathname)
  }
}

const setKbFocus = (el: HTMLElement): void => {
  kbFocusedPathname.value = el.dataset.pathname ?? null
  el.scrollIntoView({ block: 'nearest' })
}

const handleTreeKeydown = (event: KeyboardEvent): void => {
  // Rename / create inputs keep their own key handling (Enter commits,
  // Escape is handled globally) — arrows must not move tree focus meanwhile.
  if (event.target instanceof HTMLInputElement) return
  if (!NAV_KEYS.includes(event.key as TreeNavKey)) return

  const { rows, els } = gatherRows()
  if (rows.length === 0) return
  const currentIndex = els.findIndex((el) => el.dataset.pathname === kbFocusedPathname.value)
  const action = nextTreeNavState(rows, currentIndex, event.key as TreeNavKey)

  switch (action.type) {
    case 'focus':
      setKbFocus(els[action.index])
      break
    case 'open':
    case 'toggle':
    case 'expand':
    case 'collapse':
      // The row's own click handler already implements exactly this: files
      // open, folders toggle their expansion.
      els[currentIndex].click()
      break
    case 'rename':
      setKbFocus(els[currentIndex])
      projectStore.CHANGE_ACTIVE_ITEM(nodeFromRow(els[currentIndex]))
      bus.emit('SIDEBAR::rename')
      break
    case 'remove':
      projectStore.CHANGE_ACTIVE_ITEM(nodeFromRow(els[currentIndex]))
      bus.emit('SIDEBAR::remove')
      break
    case 'none':
      return
  }
  event.preventDefault()
}

const handleWrapperClick = (event: MouseEvent): void => {
  const row = (event.target as HTMLElement | null)?.closest?.(
    '[data-tree-row]'
  ) as HTMLElement | null
  if (row?.dataset.pathname) kbFocusedPathname.value = row.dataset.pathname
}

onMounted(() => {
  bus.on('SIDEBAR::show-new-input', handleInputFocus)

  // Hide rename / create inputs on outside clicks. Buttons that open these
  // inputs must use @click.stop so their click never reaches this listener.
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    if (target && target.tagName !== 'INPUT') {
      projectStore.CHANGE_ACTIVE_ITEM({})
      projectStore.createCache = {}
      projectStore.renameCache = null
    }
  })

  document.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement | null
    if (target && target.tagName !== 'INPUT') {
      projectStore.createCache = {}
      projectStore.renameCache = null
    }
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      projectStore.createCache = {}
      projectStore.renameCache = null
    }
  })
})
</script>

<style scoped>
.tree-view {
  font-size: 12px;
  font-weight: 500;
  color: var(--sideBarColor);
  display: flex;
  flex-direction: column;
  height: 100%;
}

.icon-arrow {
  margin-right: 5px;
  transition: transform 0.25s ease-out;
  transform: rotate(90deg);
  color: var(--sideBarTextColor);
  cursor: pointer;
}

.icon-arrow.fold {
  transform: rotate(0);
}

.project-tree > .title {
  height: 28px;
  line-height: 28px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.5px;
  color: var(--sideBarTextColor);
  padding-right: 15px;
  display: flex;
  align-items: center;
}

.default-cursor {
  cursor: pointer;
}
.project-tree {
  display: flex;
  flex-direction: column;
  overflow: auto;
  flex: 1;
}

.project-tree > .title > span {
  flex: 1;
  user-select: none;
}

.project-tree > .title > a {
  pointer-events: auto;
  cursor: pointer;
  margin-left: 8px;
  color: var(--sideBarIconColor);
  opacity: 0;
}

.project-tree > .title > a:hover {
  color: var(--highlightThemeColor);
}

.project-tree > .title > a.active {
  color: var(--highlightThemeColor);
}

.project-tree > .tree-wrapper {
  overflow: auto;
  flex: 1;
}

.project-tree > .tree-wrapper::-webkit-scrollbar:vertical {
  width: 8px;
}
.project-tree div.title:hover > a {
  opacity: 1;
}
.open-project {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 32px;
}

.open-project .centered-group {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.open-project .el-button {
  margin-top: 8px;
}
.open-project .el-button.is-text.is-has-bg,
.empty-project .el-button.is-text.is-has-bg {
  background-color: var(--buttonPrimaryBgColor);
  color: var(--buttonPrimaryFontColor);
  border-color: transparent;
  border-radius: var(--radius-md);
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 500;
  transition: background-color 120ms ease-out;
}
.open-project .el-button.is-text.is-has-bg:hover,
.open-project .el-button.is-text.is-has-bg:focus,
.empty-project .el-button.is-text.is-has-bg:hover,
.empty-project .el-button.is-text.is-has-bg:focus {
  background-color: var(--buttonPrimaryBgColorHover);
  color: var(--buttonPrimaryFontColorHover);
}
.new-input {
  outline: none;
  height: 24px;
  margin: 5px 0;
  padding: 0 6px;
  color: var(--sideBarColor);
  border: 1px solid var(--border-strong);
  background: var(--inputBgColor);
  /* Indent comes from padding here, so the box can fill the row. */
  width: 100%;
  box-sizing: border-box;
  border-radius: 4px;
}
.tree-wrapper {
  position: relative;
}
.empty-project {
  font-size: 12px;
  display: flex;
  flex-direction: column;
  padding-top: 40px;
  align-items: center;
  color: var(--sideBarTextColor);
  & button {
    margin-top: 10px;
  }
}

.empty-project > a {
  color: var(--highlightThemeColor);
  text-align: center;
  margin-top: 15px;
  text-decoration: none;
}
.bold {
  font-weight: 600;
}
</style>
