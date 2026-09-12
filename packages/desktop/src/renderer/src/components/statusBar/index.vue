<template>
  <div class="status-bar">
    <div class="status-left">
      <div
        class="status-btn"
        :class="{ active: preferencesStore.sourceCode }"
        :title="t('menu.view.sourceCodeMode')"
        @click="toggleSourceCode"
      >
        <svg
          width="16"
          height="14"
          viewBox="0 0 18 14"
        >
          <path
            d="M5.6 3.2 1.6 7l4 3.8m6.8-7.6 4 3.8-4 3.8M10.4 2 7.6 12"
            stroke="currentColor"
            stroke-width="1.4"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    </div>
    <div class="status-right">
      <div
        v-if="wordCount"
        class="word-count"
        :title="t('menu.counter.words')"
        @click="handleWordClick"
      >
        <span class="text-center-vertical">{{ counterText }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import bus from '@/bus'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'

/**
 * Typora-style bottom status bar: the source-code-mode toggle on the left,
 * the word counter on the right (the counter moved here from the title bar).
 * Sidebar opening lives in the view menu / shortcuts only.
 */
const { t } = useI18n()
const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()

const { currentFile } = storeToRefs(editorStore)

const wordCount = computed(() => currentFile.value?.wordCount ?? null)

const MODES = ['word', 'paragraph', 'character'] as const
type CounterMode = (typeof MODES)[number]
const show = ref<CounterMode>('word')

const counterLabel = (mode: CounterMode): string => {
  if (mode === 'word') return t('menu.counter.words')
  if (mode === 'paragraph') return t('menu.counter.paragraphs')
  return t('menu.counter.characters')
}

const counterText = computed(() => {
  if (!wordCount.value) return ''
  const count = wordCount.value[show.value]
  return `${count} ${counterLabel(show.value)}`
})

const handleWordClick = (): void => {
  const index = MODES.indexOf(show.value)
  show.value = MODES[(index + 1) % MODES.length]!
}

const toggleSourceCode = (): void => {
  bus.emit('view:toggle-view-entry', 'sourceCode')
}
</script>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--statusBarHeight);
  padding: 0 8px;
  box-sizing: border-box;
  border-top: 1px solid var(--floatBorderColor);
  /* Themed like the editor chrome so dark themes don't bleed white. */
  background: var(--editorBgColor);
  color: var(--editorColor30);
  font-size: 12px;
  user-select: none;
  flex: none;
}
.status-left {
  display: flex;
  align-items: center;
}
.status-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 20px;
  border-radius: 3px;
  cursor: pointer;
  color: var(--editorColor30);
  transition: all 0.15s ease-in-out;
}
.status-btn:hover {
  background: var(--floatHoverColor);
  color: var(--editorColor60);
}
.status-btn.active {
  color: var(--themeColor);
}
.status-right {
  display: flex;
  align-items: center;
}
.word-count {
  cursor: pointer;
  padding: 1px 6px;
  border-radius: 3px;
  color: var(--editorColor30);
  transition: all 0.15s ease-in-out;
}
.word-count:hover {
  background: var(--floatHoverColor);
  color: var(--editorColor60);
}
.text-center-vertical {
  display: inline-block;
  vertical-align: middle;
  line-height: normal;
}
</style>
