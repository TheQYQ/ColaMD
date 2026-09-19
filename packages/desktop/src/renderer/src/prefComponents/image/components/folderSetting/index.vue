<template>
  <section class="image-folder">
    <h6 class="title">
      {{ t('preferences.image.folderSetting.title') }}
    </h6>
    <div class="image-folder-path">
      <span class="label">{{ t('preferences.image.folderSetting.globalFolder') }}:</span>
      <span
        class="value"
        :title="imageFolderPath"
      >{{ imageFolderPath }}</span>
    </div>
    <div>
      <el-button
        size="mini"
        @click="modifyImageFolderPath"
      >
        {{ t('preferences.image.folderSetting.open') }}
      </el-button>
      <el-button
        size="mini"
        @click="openImageFolder"
      >
        {{ t('preferences.image.folderSetting.showInFolder') }}
      </el-button>
    </div>
    <compound>
      <template #head>
        <bool
          :description="t('preferences.image.folderSetting.preferRelative')"
          more="https://github.com/TheQYQ/ColaMD/docs/images"
          :bool="imagePreferRelativeDirectory"
          :on-change="(value) => onSelectChange('imagePreferRelativeDirectory', value)"
        />
      </template>
      <template #children>
        <CurSelect
          :description="t('preferences.image.folderSetting.relativeCopyLocation')"
          :value="imageRelativeDirectoryBase"
          :disable="!imagePreferRelativeDirectory"
          :options="imageRelativeDirectoryBaseOptions"
          :on-change="(value) => onSelectChange('imageRelativeDirectoryBase', value)"
        />
        <text-box
          :description="t('preferences.image.folderSetting.relativeFolderName')"
          :input="imageRelativeDirectoryName"
          :disable="!imagePreferRelativeDirectory"
          :regex-validator="/^(?:$|(?![a-zA-Z]:)[^\/\\].*$)/"
          :default-value="relativeDirectoryNamePlaceholder"
          :on-change="(value) => onSelectChange('imageRelativeDirectoryName', value)"
        />
        <div class="footnote">
          {{ t('preferences.image.folderSetting.filenameNote') }}
        </div>
      </template>
    </compound>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { usePreferencesStore } from '@/store/preferences'
import type { PreferencesState } from '@/store/preferences'
import Bool from '@/prefComponents/common/bool/index.vue'
import Compound from '@/prefComponents/common/compound/index.vue'
import CurSelect from '@/prefComponents/common/select/index.vue'
import TextBox from '@/prefComponents/common/textBox/index.vue'
import type { PrefSelectOption } from '@/prefComponents/common/types'

const { t } = useI18n()

const preferenceStore = usePreferencesStore()

// computed
const {
  imageFolderPath,
  imagePreferRelativeDirectory,
  imageRelativeDirectoryBase,
  imageRelativeDirectoryName
} = storeToRefs(preferenceStore)
const imageRelativeDirectoryBaseOptions = computed<PrefSelectOption<string>[]>(() => [
  {
    label: t('preferences.image.folderSetting.copyRelativeToFile'),
    value: 'file'
  },
  {
    label: t('preferences.image.folderSetting.copyRelativeToFolder'),
    value: 'folder'
  }
])
const relativeDirectoryNamePlaceholder = computed<string>(
  () => preferenceStore.imageRelativeDirectoryName || 'assets'
)

// methods
const openImageFolder = (): void => {
  window.electron.shell.openPath(imageFolderPath.value)
}

// Only the main-process folder dialog can assign this path: it is also a
// write-scope root, so a typed-in value is not accepted (see O7(1)).
const modifyImageFolderPath = (): void => {
  preferenceStore.SET_IMAGE_FOLDER_PATH()
}

const onSelectChange = (type: keyof PreferencesState, value: unknown): void => {
  preferenceStore.SET_SINGLE_PREFERENCE({ type, value })
}
</script>

<style scoped>
.image-folder-path {
  margin-bottom: 8px;
}

.image-folder-path .label {
  display: block;
  margin-bottom: 4px;
}

.image-folder-path .value {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.75;
}

.image-folder .footnote {
  font-size: 13px;
  & code {
    font-size: 13px;
  }
}
</style>
