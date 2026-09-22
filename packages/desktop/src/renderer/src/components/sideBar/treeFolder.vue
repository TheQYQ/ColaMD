<template>
  <div class="side-bar-folder">
    <div
      ref="folderEl"
      class="folder-name"
      :style="{ 'padding-left': `${depth * 6 + 10}px` }"
      :class="[{ active: folder.id === activeItem.id }]"
      :title="folder.pathname"
      @click="folderNameClick"
    >
      <el-icon
        class="icon-arrow"
        :class="{ fold: isCollapsed }"
        :size="12"
      >
        <ArrowRight />
      </el-icon>
      <input
        v-if="renameCache === folder.pathname"
        ref="renameInput"
        v-model="newName"
        type="text"
        class="rename"
        @click.stop="noop"
        @keydown.enter="rename"
      >
      <span
        v-else
        class="text-overflow"
      >{{ folder.name }}</span>
    </div>
    <div
      v-if="!isCollapsed"
      class="folder-contents"
    >
      <tree-folder
        v-for="childFolder of folder.folders"
        :key="childFolder.id"
        :folder="childFolder"
        :depth="depth + 1"
      />
      <input
        v-if="createCache.dirname === folder.pathname"
        ref="input"
        v-model="createName"
        type="text"
        class="new-input"
        :style="{ 'padding-left': `${depth * 6 + 10}px` }"
        @keydown.enter="handleInputEnter"
      >
      <File
        v-for="file of folder.files"
        :key="file.id"
        :file="file"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useProjectStore } from '@/store/project'
import { showContextMenu } from '../../contextMenu/sideBar'
import bus from '../../bus'
import File from './treeFile.vue'
import { ArrowRight } from '@element-plus/icons-vue'
import type { TreeFolderNode } from './types'

const props = defineProps<{
  folder: TreeFolderNode
  depth: number
}>()

const projectStore = useProjectStore()

const createName = ref('')
const newName = ref('')

const folderEl = ref<HTMLDivElement | null>(null)
const renameInput = ref<HTMLInputElement | null>(null)
const input = ref<HTMLInputElement | null>(null)

// Use a local reactive state for isCollapsed that syncs with the prop
const isCollapsed = ref<boolean>(!!props.folder.isCollapsed)

const { renameCache } = storeToRefs(projectStore)
const { createCache } = storeToRefs(projectStore)
const { activeItem } = storeToRefs(projectStore)
const { clipboard } = storeToRefs(projectStore)

const handleInputFocus = (): void => {
  // Only the folder that is the create target reacts. Expand it FIRST so the
  // create input renders even when the folder was collapsed, then focus it on
  // the next tick — previously the expand sat behind `if (input.value)`, which
  // is null while collapsed, so New File on a collapsed folder did nothing
  // (#3439).
  if (createCache.value.dirname !== props.folder.pathname) return
  isCollapsed.value = false
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

const folderNameClick = (): void => {
  isCollapsed.value = !isCollapsed.value
}

const noop = (): void => {}

const focusRenameInput = (): void => {
  nextTick(() => {
    if (renameInput.value) {
      renameInput.value.focus()
      newName.value = props.folder.name
    }
  })
}

const rename = (): void => {
  if (newName.value) {
    projectStore.RENAME_IN_SIDEBAR(newName.value)
  }
}

onMounted(() => {
  if (folderEl.value) {
    folderEl.value.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      projectStore.CHANGE_ACTIVE_ITEM(props.folder)
      showContextMenu(event, !!clipboard.value)
    })
  }
  bus.on('SIDEBAR::show-new-input', handleInputFocus)
  bus.on('SIDEBAR::show-rename-input', focusRenameInput)
})
</script>

<style scoped>
.side-bar-folder {
  & > .folder-name {
    cursor: default;
    user-select: none;
    display: flex;
    align-items: center;
    height: 28px;
    border-radius: 4px;
    padding-right: 12px;
    transition: background-color 120ms ease-out;
    & > .icon-arrow {
      flex-shrink: 0;
      color: var(--sideBarIconColor);
      margin-right: 5px;
      /* V1 guide §四: 160ms ease-out (not 250ms). */
      transition: transform 160ms ease-out;
      transform: rotate(90deg);
    }
    & > .icon-arrow.fold {
      transform: rotate(0);
    }
    &:hover {
      background: var(--sideBarItemHoverBgColor);
    }
  }
}
.new-input,
input.rename {
  outline: none;
  height: 24px;
  margin: 5px 0;
  padding: 0 6px;
  color: var(--sideBarColor);
  border: 1px solid var(--themeColor);
  background: var(--inputBgColor);
  border-radius: 4px;
}
/* Indent comes from padding here, so the box can fill the row. */
.new-input {
  width: 100%;
  box-sizing: border-box;
}
input.rename {
  width: 70%;
}
</style>
