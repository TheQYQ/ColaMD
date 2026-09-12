<template>
  <teleport to="body">
    <div
      v-if="visible"
      class="unsaved-dialog-mask"
      @click.self="cancel"
    >
      <div
        class="unsaved-dialog"
        role="dialog"
        aria-modal="true"
      >
        <h2 class="dialog-title">
          {{ t('dialog.save') }}
        </h2>
        <p class="dialog-message">
          {{ t('dialog.saveChanges') }}
        </p>
        <p class="dialog-detail">
          {{ t('dialog.changesWillBeLost') }}
        </p>
        <div class="dialog-buttons">
          <button
            class="dialog-btn primary"
            @click="respond(true)"
          >
            {{ t('dialog.save') }}
          </button>
          <button
            class="dialog-btn secondary"
            @click="respond(false)"
          >
            {{ t('dialog.dontSave') }}
          </button>
          <button
            class="dialog-btn secondary cancel"
            @click="cancel"
          >
            {{ t('dialog.cancel') }}
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * Typora-style unsaved-changes dialog. The main process asks this dialog to
 * show (`mt::show-unsaved-dialog`) while closing a window with unsaved tabs
 * (or closing tabs), and the choice is returned via
 * `mt::unsaved-dialog-response`: { needSave: true } (保存), { needSave: false }
 * (放弃更改) or null (取消).
 */
const { t } = useI18n()

const visible = ref(false)

const respond = (needSave: boolean): void => {
  visible.value = false
  window.electron.ipcRenderer.send('mt::unsaved-dialog-response', { needSave })
}

const cancel = (): void => {
  if (!visible.value) return
  visible.value = false
  window.electron.ipcRenderer.send('mt::unsaved-dialog-response', null)
}

const showDialog = (): void => {
  visible.value = true
}

const onKeyDown = (event: KeyboardEvent): void => {
  if (!visible.value) return
  if (event.key === 'Escape') {
    event.stopPropagation()
    cancel()
  }
}

let offShowDialog: (() => void) | null = null

onMounted(() => {
  offShowDialog = window.electron.ipcRenderer.on('mt::show-unsaved-dialog', showDialog)
  document.addEventListener('keydown', onKeyDown, true)
})

onBeforeUnmount(() => {
  offShowDialog?.()
  document.removeEventListener('keydown', onKeyDown, true)
})
</script>

<style>
/* Teleported to <body>; global (non-scoped) styles. */
.unsaved-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 12000;
  background: rgba(0, 0, 0, 0.18);
  display: flex;
  align-items: center;
  justify-content: center;
}
.unsaved-dialog {
  width: 420px;
  max-width: 86vw;
  box-sizing: border-box;
  background: var(--floatBgColor);
  border: 1px solid var(--floatBorderColor);
  border-radius: 5px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
  padding: 20px 24px;
  color: var(--editorColor80);
}
.unsaved-dialog .dialog-title {
  margin: 0 0 10px;
  font-size: 16px;
  font-weight: 600;
  color: var(--editorColor);
}
.unsaved-dialog .dialog-message {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--editorColor);
}
.unsaved-dialog .dialog-detail {
  margin: 0 0 20px;
  font-size: 12px;
  color: var(--editorColor50);
}
.unsaved-dialog .dialog-buttons {
  display: flex;
  align-items: center;
  gap: 10px;
}
.unsaved-dialog .dialog-btn {
  appearance: none;
  font-size: 12px;
  line-height: 1;
  padding: 6px 14px;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
}
.unsaved-dialog .dialog-btn.primary {
  border: none;
  background: var(--buttonPrimaryBgColor);
  color: var(--buttonPrimaryFontColor);
}
.unsaved-dialog .dialog-btn.primary:hover {
  background: var(--buttonPrimaryBgColorHover);
  color: var(--buttonPrimaryFontColorHover);
}
.unsaved-dialog .dialog-btn.secondary {
  background: transparent;
  border: 1px solid var(--floatBorderColor);
  color: var(--editorColor80);
}
.unsaved-dialog .dialog-btn.secondary:hover {
  background: var(--floatHoverColor);
}
.unsaved-dialog .dialog-btn.cancel {
  margin-left: auto;
}
</style>
