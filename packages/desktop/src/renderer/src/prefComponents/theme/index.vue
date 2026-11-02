<template>
  <div class="pref-theme">
    <h4>{{ t('preferences.theme.title') }}</h4>
    <section class="offcial-themes">
      <div
        v-for="themeItem of themes"
        :key="themeItem.name"
        class="theme"
        :class="[
          themeItem.name,
          {
            active: themeItem.name === theme,
            disabled: followSystemTheme
          }
        ]"
        :style="previewVars(themeItem.name)"
        @click="!followSystemTheme && onSelectChange('theme', themeItem.name)"
      >
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-html="themeItem.html" />
      </div>
    </section>
    <separator />

    <Bool
      :description="t('preferences.theme.followSystemTheme')"
      :bool="followSystemTheme"
      :on-change="(value) => onSelectChange('followSystemTheme', value)"
    />

    <compound v-if="followSystemTheme">
      <template #head>
        <h6 class="title">
          {{ t('preferences.theme.modeThemes') }}
        </h6>
      </template>
      <template #children>
        <cur-select
          :description="t('preferences.theme.lightModeTheme')"
          :value="lightModeTheme"
          :options="themeOptions"
          :on-change="(value) => onSelectChange('lightModeTheme', value)"
        />

        <cur-select
          :description="t('preferences.theme.darkModeTheme')"
          :value="darkModeTheme"
          :options="themeOptions"
          :on-change="(value) => onSelectChange('darkModeTheme', value)"
        />
      </template>
    </compound>

    <div class="custom-css">
      <div class="description">
        {{ t('preferences.theme.customCss') }}
      </div>
      <textarea
        class="custom-css-input"
        rows="10"
        :value="customCss"
        @change="
          (event: Event) => onSelectChange('customCss', (event.target as HTMLTextAreaElement).value)
        "
      />
    </div>
    <separator />
    <section class="import-themes">
      <div>
        <span>{{ t('preferences.theme.importCustomThemes') }}</span>
        <el-button
          size="small"
          @click="handleImportTheme"
        >
          {{ t('preferences.theme.importTheme') }}
        </el-button>
      </div>

      <div>
        <span>{{ t('preferences.theme.exportCurrentTheme') }}</span>
        <el-button
          size="small"
          @click="handleExportCurrentTheme"
        >
          {{ t('preferences.theme.exportTheme') }}
        </el-button>
      </div>
    </section>

    <section
      v-if="installedCustomThemes.length"
      class="installed-themes"
    >
      <h6 class="title">
        {{ t('preferences.theme.installedThemes') }}
      </h6>
      <ul>
        <li
          v-for="entry in installedCustomThemes"
          :key="entry.manifest.id"
          class="installed-theme-item"
        >
          <span class="theme-name">{{ entry.manifest.name }}</span>
          <span class="theme-meta">
            {{ entry.manifest.type === 'dark' ? '●' : '○' }}
            {{ entry.manifest.author || '—' }}
          </span>
          <el-button
            size="small"
            type="primary"
            @click="handleApplyCustomTheme(entry.manifest.id)"
          >
            {{ t('preferences.theme.apply') }}
          </el-button>
          <el-button
            size="small"
            @click="handleExportTheme(entry.manifest)"
          >
            {{ t('preferences.theme.export') }}
          </el-button>
          <el-button
            size="small"
            type="danger"
            @click="handleUninstallTheme(entry.manifest.id)"
          >
            {{ t('preferences.theme.uninstall') }}
          </el-button>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { usePreferencesStore } from '@/store/preferences'
import type { PreferencesState } from '@/store/preferences'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import themeMd from './theme.md?raw'
import { themes as configThemes } from './config'
import markdownToHtml from '@/util/markdownToHtml'
import Bool from '../common/bool/index.vue'
import CurSelect from '../common/select/index.vue'
import Separator from '../common/separator/index.vue'
import Compound from '../common/compound/index.vue'
import type { PrefSelectOption } from '../common/types'
import type { ColaMDThemeManifest, InstalledTheme } from '@/util/themeMarket'
import { parseThemeJson, serializeTheme, themeFileName } from '@/util/themeMarket'
import { getInstalledThemes, registerTheme, unregisterTheme } from '@/util/themeRegistry'
import { getThemePreviewMeta, type ThemePreviewMeta } from '@/util/themeColor'

interface ThemePreview {
  name: string
  html: string
}

const themes = ref<ThemePreview[]>([])

// DS-09 (GUI-SA-2): one {text, background, accent} triple per official theme,
// derived from the theme tables themselves — the old hand-maintained ~90 hex
// values in the style block had drifted (dark's accent was still the
// ancestral #409eff). Custom themes get no meta and fall back to the
// current-window vars, their pre-existing rendering.
const previewMetas = ref<Record<string, ThemePreviewMeta>>({})
const previewVars = (name: string): Record<string, string> | undefined => {
  const meta = previewMetas.value[name]
  return meta
    ? {
        '--preview-text': meta.text,
        '--preview-bg': meta.background,
        '--preview-accent': meta.accent
      }
    : undefined
}

const { t } = useI18n()
const preferenceStore = usePreferencesStore()

const { followSystemTheme, lightModeTheme, darkModeTheme, theme, customCss } =
  storeToRefs(preferenceStore)

// The installed custom themes are stored in preferences as unknown[]; we cast
// to InstalledTheme[] because the type system can't infer it. Only validated
// manifests reach preferences.
const installedCustomThemes = computed<InstalledTheme[]>(() => {
  return (preferenceStore.installedThemes as unknown as InstalledTheme[]) ?? []
})

// Generate dropdown options from configThemes
const themeOptions: PrefSelectOption<string>[] = configThemes.map((theme) => ({
  label: theme.name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' '),
  value: theme.name
}))

onMounted(async () => {
  const newThemes: ThemePreview[] = []
  for (const theme of configThemes) {
    const html = await markdownToHtml(themeMd.replace(/{theme}/, theme.name))
    newThemes.push({
      name: theme.name,
      html
    })
  }
  themes.value = newThemes
  for (const theme of newThemes) {
    const meta = await getThemePreviewMeta(theme.name)
    if (meta) previewMetas.value[theme.name] = meta
  }
})

const onSelectChange = (type: keyof PreferencesState, value: unknown): void => {
  preferenceStore.SET_SINGLE_PREFERENCE({ type, value })
}

/**
 * Imports a `.colamd-theme` file chosen by the user. On success the theme is
 * registered and persisted; on failure an error notification is shown so the
 * UI never crashes on malformed input.
 */
const handleImportTheme = async (): Promise<void> => {
  const result = await window.electron.dialog.showOpenDialog({
    title: t('preferences.theme.importTheme'),
    filters: [
      { name: t('preferences.theme.themePackage'), extensions: ['colamd-theme'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })

  if (result.canceled || !result.filePaths.length) return

  try {
    // Read as UTF-8 text — theme packages are JSON. Default may return a raw
    // Buffer for binary-looking content, so the encoding pin is required.
    const json = await window.fileUtils.readFile(result.filePaths[0], 'utf8')
    const manifest = parseThemeJson(json as string)
    registerTheme(manifest)
    persistInstalledThemes()
    await window.electron.dialog.showMessageBox({
      type: 'info',
      title: t('preferences.theme.importSuccess'),
      message: t('preferences.theme.importedThemeNamed', { name: manifest.name })
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    window.electron.dialog.showErrorBox(t('preferences.theme.importFailed'), message)
  }
}

/** Exports the currently active built-in theme as a `.colamd-theme` package. */
const handleExportCurrentTheme = async (): Promise<void> => {
  // The simple path: export the active theme CSS as a package. Built-in themes
  // don't expose raw CSS via a stable API, so we capture the live style text
  // from the DOM and wrap it in a manifest.
  const themeStyleEle = document.querySelector('#theme-style') as HTMLStyleElement | null
  if (!themeStyleEle) return

  const manifest: ColaMDThemeManifest = {
    format: 'colamd-theme',
    version: 1,
    id: theme.value,
    name: theme.value
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
    type: document.body.classList.contains('dark') ? 'dark' : 'light',
    editorCss: themeStyleEle.innerHTML.replace(/^@media not print \{\n/, '').replace(/\n\}$/, '')
  }

  await handleExportTheme(manifest)
}

/** Serializes and saves a manifest via the native save dialog. */
const handleExportTheme = async (manifest: ColaMDThemeManifest): Promise<void> => {
  const result = await window.electron.dialog.showSaveDialog({
    title: t('preferences.theme.exportTheme'),
    defaultPath: themeFileName(manifest.id),
    filters: [{ name: t('preferences.theme.themePackage'), extensions: ['colamd-theme'] }]
  })

  if (result.canceled || !result.filePath) return

  await window.fileUtils.writeFile(result.filePath, serializeTheme(manifest))
}

/** Applies a registered custom theme by setting it as the active preference. */
const handleApplyCustomTheme = (id: string): void => {
  preferenceStore.SET_SINGLE_PREFERENCE({ type: 'theme', value: id })
}

/** Uninstalls a custom theme, with confirmation, and persists the change. */
const handleUninstallTheme = async (id: string): Promise<void> => {
  const entry = installedCustomThemes.value.find((e) => e.manifest.id === id)
  if (!entry) return

  const { response } = await window.electron.dialog.showMessageBox({
    type: 'warning',
    title: t('preferences.theme.uninstall'),
    message: t('preferences.theme.uninstallConfirm', { name: entry.manifest.name }),
    buttons: [t('common.ok'), t('common.cancel')],
    defaultId: 0,
    cancelId: 1
  })

  if (response !== 0) return

  // If the removed theme is currently active, fall back to 'light'.
  if (theme.value === id) {
    preferenceStore.SET_SINGLE_PREFERENCE({ type: 'theme', value: 'light' })
  }

  unregisterTheme(id)
  persistInstalledThemes()
}

/**
 * Syncs the registry back to the preferences store so persistence and IPC
 * stay in lock-step with the in-memory map.
 */
const persistInstalledThemes = (): void => {
  preferenceStore.SET_SINGLE_PREFERENCE({
    type: 'installedThemes',
    value: getInstalledThemes()
  })
}
</script>

<style>
.offcial-themes {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  & .theme {
    cursor: pointer;
    width: 100%;
    height: 110px;
    margin: 0;
    padding: 16px 18px 16px 32px;
    overflow: hidden;
    /* DS-09 (GUI-SA-2): the per-theme triples arrive as --preview-* custom
       properties from getThemePreviewMeta; the fallbacks are the current
       window's own vars, which is what unlisted (custom) themes always
       rendered with. */
    background: var(--preview-bg, var(--editorBgColor));
    color: var(--preview-text, var(--editorColor));

    & a {
      color: var(--preview-accent, var(--themeColor));
    }
    box-sizing: border-box;
    box-shadow: 0 9px 28px -9px rgba(0, 0, 0, 0.4);
    border-radius: 6px;
    transition: opacity 0.2s ease;

    /* Disabled state when followSystemTheme is on */
    &.disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* Active theme - use outline instead of border to avoid layout shift? */
    &.active {
      box-shadow: var(--floatShadow);
      outline: 2px solid var(--themeColor);
      outline-offset: -2px;
    }

    /* Active + disabled: slightly more visible */
    &.disabled.active {
      opacity: 0.7;
    }
  }
  & h3 {
    position: relative;
    margin: 0;
    font-size: 16px;
    color: currentColor;
    cursor: pointer;
    &::before {
      content: 'h3';
      position: absolute;
      top: 4px;
      left: -20px;
      display: block;
      width: 10px;
      height: 10px;
      font-size: 12px;
      opacity: 0.5;
    }
  }
  & p {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.custom-css {
  margin: 20px 0;
  font-size: 13px;
  color: var(--editorColor);
  & .description {
    margin-bottom: 10px;
  }
  & .custom-css-input {
    width: 100%;
    background: transparent;
    color: var(--editorColor);
    border: 1px solid var(--editorColor10);
    border-radius: 4px;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    box-sizing: border-box;
    resize: vertical;
  }
  & .custom-css-input:focus {
    outline: none;
    border-color: var(--themeColor);
  }
}

.import-themes {
  padding: 10px 0;
  display: flex;
  gap: 24px;
  color: var(--editorColor);
  & > div {
    display: flex;
    flex-direction: column;
    & > span {
      display: inline-block;
      margin-bottom: 12px;
    }
  }
}

.installed-themes {
  margin-top: 16px;
  color: var(--editorColor);
  & .title {
    margin: 0 0 10px;
    font-size: 13px;
    font-weight: 600;
  }
  & ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  & .installed-theme-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    background: var(--editorBgColor);
    border: 1px solid var(--editorColor10);
    border-radius: 6px;
    & .theme-name {
      flex: 1;
      font-weight: 500;
    }
    & .theme-meta {
      font-size: 12px;
      opacity: 0.6;
      white-space: nowrap;
    }
  }
}
</style>
