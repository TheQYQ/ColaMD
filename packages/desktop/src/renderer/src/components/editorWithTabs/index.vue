<template>
  <div
    class="editor-with-tabs"
    :style="{ 'max-width': `calc(100vw - ${effectiveSideBarWidth}px)` }"
  >
    <tabs v-show="showTabBar" />
    <div class="container">
      <editor
        :markdown="markdown"
        :cursor="cursor"
        :text-direction="textDirection"
        :platform="platform"
      />
      <source-code
        v-if="sourceCode"
        :markdown="markdown"
        :muya-index-cursor="muyaIndexCursor"
        :text-direction="textDirection"
      />
    </div>
    <!-- Search bar lives above both panes (rendered after them) so it stays
         visible in WYSIWYG and source-code mode alike. -->
    <editor-search v-if="hasCurrentFile" />
    <tab-notifications />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '@/store/editor'
import { useLayoutStore } from '@/store/layout'
import { storeToRefs } from 'pinia'
import Tabs from './tabs.vue'
import Editor from './editor.vue'
import SourceCode from './sourceCode.vue'
import TabNotifications from './notifications.vue'
import EditorSearch from '../search/index.vue'

defineProps<{
  markdown: string
  // `cursor` originates as `IFileState.cursor` which is `unknown`
  // (see src/shared/types/files.ts); align here instead of forcing every
  // caller to widen.
  cursor: unknown
  muyaIndexCursor?: unknown
  sourceCode: boolean
  showTabBar: boolean
  textDirection: string
  platform: string
}>()

const { effectiveSideBarWidth } = storeToRefs(useLayoutStore())
const editorStore = useEditorStore()
const { tabs } = storeToRefs(editorStore)
// `currentFile` is briefly null mid tab-switch; gate on any open tab so the
// find bar does not unmount and lose focus state on every switch.
const hasCurrentFile = computed(() => tabs.value.length > 0)
</script>

<style scoped>
.editor-with-tabs {
  position: relative;
  height: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;

  overflow: hidden;
  background: var(--editorBgColor);
  & > .container {
    flex: 1;
    overflow: hidden;
  }
}
</style>
