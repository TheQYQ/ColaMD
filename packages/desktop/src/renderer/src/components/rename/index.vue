<template>
  <div class="rename">
    <el-dialog
      v-model="showRename"
      :show-close="false"
      :modal="true"
      custom-class="ag-dialog-table"
      width="410px"
    >
      <template #title>
        <div class="search-wrapper">
          <div class="input-wrapper">
            <input
              ref="search"
              v-model="tempName"
              type="text"
              class="search"
              @keyup.enter="confirm"
            >
            <span
              v-if="extension"
              class="locked-extension"
            >{{ extension }}</span>
            <el-icon
              :size="16"
              class="confirm-icon"
              @click="confirm"
            >
              <Check />
            </el-icon>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import bus from '../../bus'
import { useEditorStore } from '@/store/editor'
import { Check } from '@element-plus/icons-vue'

const showRename = ref(false)
const tempName = ref('')
const search = ref<HTMLInputElement | null>(null)

const editorStore = useEditorStore()

const filename = computed(() => editorStore.currentFile?.filename ?? '')

// UX-10 (#GUI-B10): mirror the sidebar inline rename — edit the stem, show
// the extension locked beside it, so renaming cannot accidentally change the
// file type. `dot > 0` keeps dotfiles (.md) as a whole stem.
const stem = computed(() => {
  const name = filename.value
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
})
const extension = computed(() => {
  const name = filename.value
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
})

const handleRename = () => {
  showRename.value = true
  tempName.value = stem.value
  nextTick(() => {
    if (search.value) {
      search.value.focus()
      search.value.select()
    }
  })
}

const confirm = () => {
  editorStore.RENAME(tempName.value + extension.value)
  showRename.value = false
}

onMounted(() => {
  bus.on('rename', handleRename)
})

onBeforeUnmount(() => {
  bus.off('rename', handleRename)
})
</script>

<style>
.rename .el-dialog__header {
  box-sizing: border-box;
}
.rename .el-dialog__body {
  display: none;
}
</style>

<style scoped>
.search-wrapper {
  margin-top: 8px;
  z-index: 10000;
  position: relative;
  left: 50%;
  transform: translateX(-50%);
  width: 410px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: none;
  border: none;
  border-radius: 4px;
  margin: 0;
  padding: 0 8px;

  & .input-wrapper {
    display: flex;
    width: 100%;
    & input {
      background: transparent;
    }
  }
}
.locked-extension {
  display: inline-flex;
  align-items: center;
  padding-right: 8px;
  font-size: 13px;
  color: var(--text-tertiary);
  user-select: none;
}
.search {
  width: 100%;
  height: 30px;
  outline: none;
  border: none;
  font-size: 13px;
  padding: 0 8px;
  margin: 0 10px;
  color: var(--sideBarColor);
}
.search-wrapper svg {
  cursor: pointer;
  margin: 0 5px;
  width: 30px;
  height: 30px;
  color: var(--iconColor);
  transition: color 0.3s ease-in-out;
}
.search-wrapper svg:hover {
  color: var(--themeColor);
}
</style>
