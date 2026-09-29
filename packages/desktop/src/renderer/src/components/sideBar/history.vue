<template>
  <div class="side-bar-history">
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
        @click="openPreview(snapshot)"
      >
        <div class="snapshot-header">
          <span class="snapshot-label">
            {{ snapshot.label }}
          </span>
          <span class="snapshot-time">
            {{ formatTime(snapshot.timestamp) }}
          </span>
        </div>
        <div class="snapshot-size">
          {{ formatSize(snapshot.byteLength) }}
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

    <!-- Preview dialog: the body is fetched on demand, the list ships metadata only -->
    <el-dialog
      v-model="preview.visible"
      :title="t('sideBar.history.previewTitle')"
      width="70%"
      align-center
    >
      <div
        v-if="preview.meta"
        v-loading="preview.loading"
        class="preview-content"
      >
        <div class="preview-meta">
          <span>{{ preview.meta.label }}</span>
          <span>{{ formatTime(preview.meta.timestamp) }}</span>
        </div>
        <pre class="preview-markdown">{{ preview.content }}</pre>
      </div>
      <template #footer>
        <el-button @click="preview.visible = false">
          {{ t('sideBar.history.close') }}
        </el-button>
        <el-button
          v-if="preview.meta"
          type="primary"
          :disabled="preview.loading"
          @click="restoreSnapshot(preview.meta)"
        >
          {{ t('sideBar.history.restore') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useEditorStore } from '@/store/editor'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { VersionSnapshotMeta } from '@shared/types/ipc'
import bus from '../../bus'

const { t } = useI18n()
const editorStore = useEditorStore()
const { currentFile } = storeToRefs(editorStore)

const snapshots = ref<VersionSnapshotMeta[]>([])
const loading = ref(false)
const preview = reactive({
  visible: false,
  loading: false,
  meta: null as VersionSnapshotMeta | null,
  content: ''
})

const currentPathname = computed<string>(() => currentFile.value?.pathname ?? '')

const sortedSnapshots = computed<VersionSnapshotMeta[]>(() => {
  return [...snapshots.value].sort((a, b) => b.timestamp - a.timestamp)
})

const loadSnapshots = async (): Promise<void> => {
  const requested = currentPathname.value
  if (!requested) {
    snapshots.value = []
    loading.value = false
    return
  }

  loading.value = true
  try {
    const list = (await window.versionHistory.list(requested)) ?? []
    // A rapid file switch starts a newer load while this one is in flight;
    // a stale response must not overwrite the newer result (or clear its
    // loading flag early).
    if (requested !== currentPathname.value) return
    snapshots.value = list
  } catch (err) {
    if (requested !== currentPathname.value) return
    console.error('Failed to load version history:', err)
    snapshots.value = []
  } finally {
    if (requested === currentPathname.value) loading.value = false
  }
}

// The store emits this after every snapshot lands (save / auto-save / tab
// close), so an open panel reflects new versions without a manual refresh.
const onSnapshotSaved = (): void => {
  nextTick(loadSnapshots)
}

onMounted(() => {
  bus.on('version-snapshot-saved', onSnapshotSaved)
})

onBeforeUnmount(() => {
  bus.off('version-snapshot-saved', onSnapshotSaved)
})

watch(
  currentPathname,
  () => {
    preview.visible = false
    preview.meta = null
    nextTick(loadSnapshots)
  },
  { immediate: true }
)

const openPreview = async (snapshot: VersionSnapshotMeta): Promise<void> => {
  preview.meta = snapshot
  preview.content = ''
  preview.visible = true
  preview.loading = true
  try {
    const content = await window.versionHistory.getContent(snapshot.pathname, snapshot.id)
    preview.content = content ?? ''
  } catch (err) {
    console.error('Failed to load snapshot content:', err)
    preview.content = ''
  } finally {
    preview.loading = false
  }
}

const restoreSnapshot = async (snapshot: VersionSnapshotMeta): Promise<void> => {
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
  } catch {
    // User cancelled
    return
  }

  const content = await window.versionHistory.getContent(snapshot.pathname, snapshot.id)
  if (content === null) {
    ElMessage.error(t('sideBar.history.restoreFailed'))
    return
  }

  // The editor store listens for this event and writes the content back into
  // the matching tab (after snapshotting the pre-restore state).
  const event = new CustomEvent('version-history:restore', {
    detail: { markdown: content, pathname: snapshot.pathname }
  })
  window.dispatchEvent(event)

  ElMessage.success(t('sideBar.history.restoreSuccess'))
  preview.visible = false
}

const deleteSnapshot = async (snapshot: VersionSnapshotMeta): Promise<void> => {
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
  } catch {
    // User cancelled
    return
  }

  const success = await window.versionHistory.delete(snapshot.pathname, snapshot.id)
  if (success) {
    snapshots.value = snapshots.value.filter((s) => s.id !== snapshot.id)
    ElMessage.success(t('sideBar.history.deleteSuccess'))
  } else {
    ElMessage.error(t('sideBar.history.deleteFailed'))
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
  } catch {
    // User cancelled
    return
  }

  const success = await window.versionHistory.clear(currentPathname.value)
  if (success) {
    snapshots.value = []
    ElMessage.success(t('sideBar.history.clearSuccess'))
  } else {
    ElMessage.error(t('sideBar.history.clearFailed'))
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

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<style scoped>
.side-bar-history {
  height: 100%;
  margin: 0;
  padding: 8px 0 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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

.snapshot-size {
  font-size: 11px;
  opacity: 0.6;
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
