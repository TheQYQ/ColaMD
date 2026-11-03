<template>
  <div class="recent-files-projects">
    <div class="centered-group">
      {{ t('recent.noTabsOpen') }}
      <el-button
        text
        bg
        type="primary"
        @click="newFile"
      >
        {{ t('recent.newFile') }}
      </el-button>
      <div class="secondary-actions">
        <el-button
          text
          bg
          @click="openFile"
        >
          {{ t('menu.file.openFile') }}
        </el-button>
        <el-button
          text
          bg
          @click="openFolder"
        >
          {{ t('menu.file.openFolder') }}
        </el-button>
      </div>
      <template v-if="recentDocuments.length">
        <div class="section-heading">
          {{ t('recent.recentHeading') }}
        </div>
        <ul class="recent-list">
          <li
            v-for="filePath in recentDocuments.slice(0, 5)"
            :key="filePath"
            :title="filePath"
            @click="openRecent(filePath)"
          >
            {{ filePath }}
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useEditorStore } from '@/store/editor'
import { t } from '../../i18n'

const editorStore = useEditorStore()

const recentDocuments = ref<string[]>([])

const newFile = () => {
  editorStore.NEW_UNTITLED_TAB({})
}

// UX-08 (#GUI-B10): the empty state is the cold-start front door — opening an
// existing document is at least as likely an intent as creating one, and the
// recent list (same source the File menu uses) covers the rest.
const openFile = () => {
  window.electron.ipcRenderer.send('mt::cmd-open-file')
}

const openFolder = () => {
  window.electron.ipcRenderer.send('mt::cmd-open-folder')
}

const openRecent = (filePath: string) => {
  window.electron.ipcRenderer.send('mt::menu::open-path', filePath)
}

onMounted(async () => {
  try {
    const list = await window.electron.ipcRenderer.invoke('mt::menu::get-recent-documents')
    recentDocuments.value = Array.isArray(list) ? (list as string[]) : []
  } catch {
    recentDocuments.value = []
  }
})
</script>

<style scoped>
.recent-files-projects {
  background: var(--editorBgColor);
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-around;
  & .centered-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    /* Empty state copy reads as a hint, not a heading (guide §2.3). */
    color: var(--text-tertiary);
    font-size: 13px;
    line-height: 1.7;
    & .el-button {
      margin-top: 24px;
    }
    /* The one allowed accent-solid CTA in the app (guide §3.2B). */
    & .el-button.is-text.is-has-bg {
      background-color: var(--buttonPrimaryBgColor);
      color: var(--buttonPrimaryFontColor);
      border-color: transparent;
      border-radius: var(--radius-md);
      padding: 8px 20px;
      font-size: 13px;
      font-weight: 500;
      transition: background-color 120ms ease-out;
    }
    & .el-button.is-text.is-has-bg:hover,
    & .el-button.is-text.is-has-bg:focus {
      background-color: var(--buttonPrimaryBgColorHover);
      color: var(--buttonPrimaryFontColorHover);
    }
    /* UX-08 (#GUI-B10): secondary CTAs and the recent list. */
    & .secondary-actions {
      margin-top: 12px;
      display: flex;
      gap: 8px;
      & .el-button {
        margin-top: 0;
        font-size: 12px;
      }
    }
    & .section-heading {
      margin-top: 28px;
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      opacity: 0.7;
    }
    & .recent-list {
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
      max-width: 460px;
      & li {
        font-size: 12px;
        line-height: 24px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
        border-radius: var(--radius-sm);
        padding: 0 8px;
        &:hover {
          background: var(--bg-hover);
          color: var(--text-secondary);
        }
      }
    }
  }
}
</style>
