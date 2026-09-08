<template>
  <div class="side-bar-history">
    <div class="title">
      {{ t('sideBar.history.title') }}
    </div>

    <div
      v-if="!currentPathname"
      class="empty-hint"
    >
      {{ t('sideBar.history.noFile') }}
    </div>

    <div
      v-else-if="loading"
      class="empty-hint"
    >
      {{ t('sideBar.history.loading') }}
    </div>

    <div
      v-else-if="snapshots.length === 0"
      class="empty-hint"
    >
      {{ t('sideBar.history.noSnapshots') }}
    </div>

    <div
      v-else
      class="snapshot-list"
    >
      <div
        v-for="snapshot in sortedSnapshots"
        :key="snapshot.id"
        class="snapshot-item"
        :class="{ selected: selectedId === snapshot.id }"
        @click="selectSnapshot(snapshot)"
      >
        <div class="snapshot-header">
          <span class="snapshot-label">
            {{ snapshot.label }}
          </span>
          <span class="snapshot-time">
            {{ formatTime(snapshot.timestamp) }}
          </span>
        </div>
        <div class="snapshot-preview">
          {{ preview(snapshot.markdown) }}
        </div>
        <div class="snapshot-actions">
          <el-button
            size="small"
            type="primary"
            link
            @click.stop="restoreSnapshot(snapshot)"
          >
            {{ t('sideBar.history.restore') }}
          </el-button>
          <el-button
            size="small"
            type="danger"
            link
            @click.stop="deleteSnapshot(snapshot)"
          >
            {{ t('sideBar.history.delete') }}
          </el-button>
        </div>
      </div>
    </div>

    <div
      v-if="currentPathname && snapshots.length > 0"
      class="footer-actions"
    >
      <el-button
        size="small"
        type="danger"
        link
        @click="clearAll"
      >
        {{ t('sideBar.history.clearAll') }}
      </el-button>
    </div>

    <!-- Diff/Preview dialog -->
    <el-dialog
      v-model="previewVisible"
      :title="t('sideBar.history.previewTitle')"
      width="70%"
      align-center
    >
      <div class="preview-content">
        <div class="preview-meta">
          <span>{{ previewSnapshot?.label }}</span>
          <span>{{ previewSnapshot ? formatTime(previewSnapshot.timestamp) : '' }}</span>
        </div>
        <pre class="preview-markdown">{{ previewSnapshot?.markdown }}</pre>
      </div>
      <template #footer>
        <el-button @click="previewVisible = false">
          {{ t('sideBar.history.close') }}
        </el-button>
        <el-button
          v-if="previewSnapshot"
          type="primary"
          @click="restoreSnapshot(previewSnapshot)"
        >
          {{ t('sideBar.history.restore') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useEditorStore } from '@/store/editor'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { VersionSnapshot } from '@shared/types/ipc'

const { t } = useI18n()
const editorStore = useEditorStore()
const { currentFile } = storeToRefs(editorStore)

const snapshots = ref<VersionSnapshot[]>([])
const loading = ref(false)
const selectedId = ref<string | null>(null)
const previewVisible = ref(false)
const previewSnapshot = ref<VersionSnapshot | null>(null)

const currentPathname = computed<string>(() => currentFile.value?.pathname ?? '')

const sortedSnapshots = computed<VersionSnapshot[]>(() => {
  return [...snapshots.value].sort((a, b) => b.timestamp - a.timestamp)
})

const loadSnapshots = async (): Promise<void> => {
  if (!currentPathname.value) {
    snapshots.value = []
    return
  }

  loading.value = true
  try {
    const result = await window.versionHistory.get(currentPathname.value)
    snapshots.value = result ?? []
  } catch (err) {
    console.error('Failed to load version history:', err)
    snapshots.value = []
  } finally {
    loading.value = false
  }
}

watch(
  currentPathname,
  () => {
    selectedId.value = null
    previewVisible.value = false
    previewSnapshot.value = null
    nextTick(loadSnapshots)
  },
  { immediate: true }
)

const selectSnapshot = async (snapshot: VersionSnapshot): Promise<void> => {
  selectedId.value = snapshot.id
  previewSnapshot.value = snapshot
  previewVisible.value = true
}

const restoreSnapshot = async (snapshot: VersionSnapshot): Promise<void> => {
  try {
    await ElMessageBox.confirm(
      t('sideBar.history.restoreConfirm'),
      t('sideBar.history.restoreTitle'),
      {
        confirmButtonText: t('sideBar.history.restore'),
        cancelButtonText: t('sideBar.history.cancel'),
        type: 'warning'
      }
    )

    const content = await window.versionHistory.getContent(snapshot.pathname, snapshot.id)
    if (content === null) {
      ElMessage.error(t('sideBar.history.restoreFailed'))
      return
    }

    // Emit an event that the editor can listen to restore content
    const event = new CustomEvent('version-history:restore', {
      detail: { markdown: content, pathname: snapshot.pathname }
    })
    window.dispatchEvent(event)

    ElMessage.success(t('sideBar.history.restoreSuccess'))
    previewVisible.value = false
  } catch {
    // User cancelled
  }
}

const deleteSnapshot = async (snapshot: VersionSnapshot): Promise<void> => {
  try {
    await ElMessageBox.confirm(
      t('sideBar.history.deleteConfirm'),
      t('sideBar.history.deleteTitle'),
      {
        confirmButtonText: t('sideBar.history.delete'),
        cancelButtonText: t('sideBar.history.cancel'),
        type: 'warning'
      }
    )

    const success = await window.versionHistory.delete(snapshot.pathname, snapshot.id)
    if (success) {
      snapshots.value = snapshots.value.filter((s) => s.id !== snapshot.id)
      ElMessage.success(t('sideBar.history.deleteSuccess'))
    } else {
      ElMessage.error(t('sideBar.history.deleteFailed'))
    }
  } catch {
    // User cancelled
  }
}

const clearAll = async (): Promise<void> => {
  if (!currentPathname.value) return

  try {
    await ElMessageBox.confirm(t('sideBar.history.clearConfirm'), t('sideBar.history.clearTitle'), {
      confirmButtonText: t('sideBar.history.clearAll'),
      cancelButtonText: t('sideBar.history.cancel'),
      type: 'warning'
    })

    const success = await window.versionHistory.clear(currentPathname.value)
    if (success) {
      snapshots.value = []
      ElMessage.success(t('sideBar.history.clearSuccess'))
    } else {
      ElMessage.error(t('sideBar.history.clearFailed'))
    }
  } catch {
    // User cancelled
  }
}

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return t('sideBar.history.justNow')
  if (diffMins < 60) return t('sideBar.history.minutesAgo', { count: diffMins })

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return t('sideBar.history.hoursAgo', { count: diffHours })

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return t('sideBar.history.daysAgo', { count: diffDays })

  return date.toLocaleDateString()
}

const preview = (markdown: string): string => {
  const cleaned = markdown.replace(/[#*`[\]()]/g, '').trim()
  return cleaned.length > 80 ? cleaned.slice(0, 80) + '...' : cleaned
}
</script>

<style scoped>
.side-bar-history {
  height: calc(100% - 35px);
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.title {
  color: var(--sideBarTitleColor);
  font-weight: 600;
  font-size: 16px;
  margin: 37px 0 10px 0;
  padding-left: 25px;
}

.empty-hint {
  padding: 20px 25px;
  color: var(--sideBarTextColor);
  opacity: 0.6;
  font-size: 13px;
}

.snapshot-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 10px;
}

.snapshot-item {
  padding: 10px 12px;
  margin-bottom: 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;
  border: 1px solid transparent;
}

.snapshot-item:hover {
  background: var(--sideBarItemHoverBgColor);
}

.snapshot-item.selected {
  border-color: var(--themeColor);
  background: var(--sideBarItemHoverBgColor);
}

.snapshot-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.snapshot-label {
  font-weight: 600;
  font-size: 12px;
  color: var(--themeColor);
}

.snapshot-time {
  font-size: 11px;
  opacity: 0.6;
}

.snapshot-preview {
  font-size: 12px;
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 6px;
}

.snapshot-actions {
  display: flex;
  gap: 8px;
}

.footer-actions {
  padding: 10px 15px;
  border-top: 1px solid var(--itemBgColor);
  text-align: center;
}

.preview-content {
  display: flex;
  flex-direction: column;
  max-height: 60vh;
}

.preview-meta {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 13px;
  opacity: 0.7;
}

.preview-markdown {
  background: var(--editorBgColor);
  border-radius: 6px;
  padding: 16px;
  overflow-y: auto;
  max-height: 50vh;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: monospace;
  font-size: 13px;
  margin: 0;
}
</style>
