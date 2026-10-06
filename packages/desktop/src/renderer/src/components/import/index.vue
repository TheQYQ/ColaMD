<template>
  <div class="import-dialog">
    <el-dialog
      v-model="showImport"
      :show-close="false"
      :modal="true"
      custom-class="ag-dialog-table"
      width="450px"
    >
      <div class="body">
        <div
          class="drop-container"
          :class="{ active: isOver }"
          @dragenter.prevent="dragOverHandler"
          @dragover.prevent="dragOverHandler"
          @dragleave="dragLeaveHandler"
          @drop.prevent="dropHandler"
        >
          <div class="img-wrapper">
            <img
              :src="`${importIcon.url}`"
              alt="import file"
            >
          </div>
          <div>{{ t('import.title') }}</div>
          <p>{{ t('import.description') }}</p>
        </div>
        <div class="file-list">
          <div>.md</div>
          <div>.html</div>
          <div>.docx</div>
          <div>.tex</div>
          <div>.wiki</div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import bus from '@/bus'
import importIconUrl from '@/assets/icons/import_file.svg?url'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const importIcon = ref({ url: importIconUrl })
const showImport = ref(false)
const isOver = ref(false)

const showDialog = (value: unknown) => {
  const boolean = Boolean(value)
  if (boolean !== showImport.value) {
    showImport.value = boolean
  }
}

const dragOverHandler = () => {
  isOver.value = true
}

const dragLeaveHandler = () => {
  isOver.value = false
}

// The drop itself is handled by the preload's own listener (dropBridge): it
// resolves paths from the real OS drop and is the only sender the main
// process trusts for mt::window::drop. The overlay only shows the affordance
// and keeps the default navigation from swallowing the file.
const dropHandler = (e: DragEvent) => {
  e.preventDefault()
}

onMounted(() => {
  bus.on('importDialog', showDialog)
})

onBeforeUnmount(() => {
  bus.off('importDialog', showDialog)
})
</script>

<style scoped>
.drop-container {
  border-radius: 5px;
  color: var(--sideBarColor);
  border: 1px dashed var(--sideBarTextColor);
  -webkit-app-region: no-drag;
  app-region: no-drag;
  & div,
  & p {
    text-align: center;
  }
  &.active {
    border: 1px dashed var(--themeColor);
    background-color: var(--itemBgColor);
  }
}
.img-wrapper {
  width: 50px;
  height: 70px;
  margin: 40px auto 0 auto;
  & img {
    width: 100%;
    height: 100%;
  }
}
.file-list {
  margin-top: 20px;
  display: flex;
  justify-content: space-between;
  & div {
    width: 70px;
    height: 70px;
    border: 1px solid var(--sideBarTextColor);
    border-radius: 3px;
    text-align: center;
    font-size: 18px;
    line-height: 70px;
    color: var(--sideBarTitleColor);
  }
}
</style>
