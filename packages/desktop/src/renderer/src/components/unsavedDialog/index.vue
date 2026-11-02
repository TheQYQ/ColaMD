<template>
  <teleport to="body">
    <div
      v-if="visible"
      class="unsaved-dialog-mask"
      @click.self="cancel"
    >
      <div
        ref="dialogEl"
        class="unsaved-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('dialog.save')"
      >
        <h2 class="dialog-title">
          {{ t('dialog.save') }}
        </h2>
        <p class="dialog-message">
          {{ t('dialog.saveChanges') }}
        </p>
        <ul
          v-if="fileNames.length"
          class="dialog-file-list"
        >
          <li
            v-for="name in shownFileNames"
            :key="name"
            :title="name"
          >
            {{ name }}
          </li>
          <li
            v-if="hiddenCount > 0"
            class="more"
          >
            {{ t('dialog.moreFiles', { count: hiddenCount }) }}
          </li>
        </ul>
        <p class="dialog-detail">
          {{ t('dialog.changesWillBeLost') }}
        </p>
        <div class="dialog-buttons">
          <button
            ref="saveButton"
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
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * Typora-style unsaved-changes dialog. The main process asks this dialog to
 * show (`mt::show-unsaved-dialog`, payload: the unsaved files' names) while
 * closing a window with unsaved tabs (or closing tabs), and the choice is
 * returned via `mt::unsaved-dialog-response`: { needSave: true } (保存),
 * { needSave: false } (放弃更改) or null (取消).
 */
const { t } = useI18n()

const visible = ref(false)
const fileNames = ref<string[]>([])

/** Collapse long lists into five names plus an "and N more" line. */
const MAX_SHOWN = 5
const shownFileNames = computed(() => fileNames.value.slice(0, MAX_SHOWN))
const hiddenCount = computed(() => Math.max(0, fileNames.value.length - MAX_SHOWN))

const dialogEl = ref<HTMLElement | null>(null)
const saveButton = ref<HTMLButtonElement | null>(null)
let lastFocused: HTMLElement | null = null

const restoreFocus = (): void => {
  lastFocused?.focus()
  lastFocused = null
}

const respond = (needSave: boolean): void => {
  visible.value = false
  restoreFocus()
  window.electron.ipcRenderer.send('mt::unsaved-dialog-response', { needSave })
}

const cancel = (): void => {
  if (!visible.value) return
  visible.value = false
  restoreFocus()
  window.electron.ipcRenderer.send('mt::unsaved-dialog-response', null)
}

const showDialog = (_event: unknown, names?: string[]): void => {
  // #GUI-B1 UX-03: the payload used to be dropped, so a close with three dirty
  // files asked "save changes?" without saying which. Landing focus on "save"
  // also makes Enter confirm the safe action; without it focus stayed behind
  // the mask and Enter did nothing (A11Y-03).
  fileNames.value = Array.isArray(names) ? names : []
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  visible.value = true
  nextTick(() => saveButton.value?.focus())
}

const onKeyDown = (event: KeyboardEvent): void => {
  if (!visible.value) return
  if (event.key === 'Escape') {
    event.stopPropagation()
    cancel()
    return
  }
  // Focus trap: keep Tab cycling among the three dialog buttons (#GUI-B1
  // A11Y-03) instead of letting it wander back into the masked editor.
  if (event.key === 'Tab' && dialogEl.value) {
    const buttons = Array.from(
      dialogEl.value.querySelectorAll<HTMLButtonElement>('button.dialog-btn')
    )
    if (buttons.length === 0) return
    event.preventDefault()
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let nextIndex: number
    if (event.shiftKey) {
      nextIndex = index <= 0 ? buttons.length - 1 : index - 1
    } else {
      nextIndex = index === buttons.length - 1 || index === -1 ? 0 : index + 1
    }
    buttons[nextIndex]?.focus()
    return
  }
  // Enter confirms the default (safe) action unless a dialog button already
  // has focus and will activate natively.
  if (event.key === 'Enter' && !(document.activeElement instanceof HTMLButtonElement)) {
    event.preventDefault()
    respond(true)
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
  /* Toast tier (see the ladder in styles/index.css): a data-loss decision
     dialog must beat every float. */
  z-index: 12000;
  background: var(--maskColor);
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
  border-radius: 6px;
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
.unsaved-dialog .dialog-file-list {
  margin: 0 0 16px;
  padding: 8px 12px;
  max-height: 132px;
  overflow-y: auto;
  box-sizing: border-box;
  list-style: none;
  background: var(--editorBgColor);
  border: 1px solid var(--floatBorderColor);
  border-radius: 4px;
}
.unsaved-dialog .dialog-file-list li {
  font-size: 12px;
  line-height: 20px;
  color: var(--editorColor);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.unsaved-dialog .dialog-file-list li.more {
  color: var(--editorColor50);
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
  border-radius: 4px;
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
