import { createApp, type App } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import bootstrapRenderer from './bootstrap'
import pinia from './store'
import './assets/symbolIcon'

// Element Plus instead of Element UI for Vue 3. The JS side is resolved per
// component by unplugin-vue-components (electron.vite.config.ts); the full
// stylesheet stays global so component styles cannot regress (#GUI-B5). The
// plugin's default locale is already `en`, which is what `app.use` forced.
import 'element-plus/dist/index.css'

// I18n translation system
import i18nPlugin from './i18n'

import routes from './router'
import Main from './Main.vue'

import './assets/styles/index.css'
import './assets/styles/printService.css'
// PERF-01 (#GUI-B5): must register during entry-chunk evaluation — see the
// module itself for why the bootstrap IPC cannot be allowed to race the lazy
// route chunk.
import './bootstrapBuffer'

// -----------------------------------------------

window.colamd = {}
bootstrapRenderer()

// -----------------------------------------------
// Be careful when changing code before this line!

// Create Vue app
const app: App<Element> = createApp(Main)

const envType = window.colamd?.env?.type as string | undefined

const router = createRouter({
  history: createWebHashHistory(),
  // it seems like something might have changed in vue-router? it uses the full "file path" instead of
  // links like /editor if we use the old createWebHistory()
  routes: routes(envType)
})

app.use(router)
app.use(pinia)
app.use(i18nPlugin)

// Mount the app
app.mount('#app')
