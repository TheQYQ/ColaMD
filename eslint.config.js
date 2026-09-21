import eslintJs from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import pluginJsonc from 'eslint-plugin-jsonc'
import neostandard from 'neostandard'
import babelParser from '@babel/eslint-parser'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'
import globals from 'globals'
const { configs: js } = eslintJs

export default [
  // 0. Global ignores (must be first)
  {
    ignores: [
      '.claude/**',
      '**/out/**',
      '**/dist/**',
      // muya self-lints with its own antfu-based config
      // (packages/muya/eslint.config.mjs). Different style rules from the
      // colamd-desktop config (4-space indent, semis required, strict
      // ts/no-explicit-any), so we keep them isolated rather than try to
      // merge two flat configs.
      'packages/muya/**',
      'packages/desktop/src/renderer/src/assets/symbolIcon/index.js',
      '**/*.min.json',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/coverage/**'
    ]
  },

  // 1. ESLint core recommended
  js.recommended,
  ...neostandard(),

  // 2. typescript-eslint recommended — scoped to TS files only.
  // .vue files are added to this scope in Commit 8 (when they convert to
  // lang="ts"). Until then they're treated as JS by section 5.
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts']
  })),

  // 3. TS/TSX files: typescript-eslint parser
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
        // `project: ...` (type-aware linting) intentionally omitted — too slow
        // for ~200-file lint on every PR. Add a separate `lint:types` script
        // later if we want type-aware rules.
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        COLAMD_VERSION_STRING: 'readonly',
        COLAMD_VERSION: 'readonly',
        __static: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' }
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // Disable JS-only rules that double-trigger or fight TS:
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-redeclare': 'off',
      // neostandard enables core no-void; `void` is intentional for
      // fire-and-forget async IIFEs in the main process (windowManager).
      'no-void': ['error', { allowAsStatement: true }],
      // Defer to @stylistic/no-extra-semi (set by neostandard) — it knows
      // about leading-semi standard-style guards; the deprecated core rule
      // does not.
      'no-extra-semi': 'off',
      '@stylistic/indent': ['error', 2, { SwitchCase: 1, ignoreComments: true }],
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/space-before-function-paren': ['error', 'never'],
      '@stylistic/arrow-parens': 'off',
      '@stylistic/no-mixed-operators': 'off'
    }
  },

  // 4. Vue plugin baseline
  ...pluginVue.configs['flat/recommended'],

  // 5. Vue files: vue-eslint-parser with delegated TS sub-parser for <script lang="ts">
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: {
          ts: tseslint.parser,
          tsx: tseslint.parser,
          js: babelParser,
          jsx: babelParser
        },
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
        requireConfigFile: false
      },
      globals: { ...globals.browser }
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/require-default-prop': 'off',
      // Core no-unused-vars cannot see component usage inside <template>
      // (e.g. <tabs> referring to Tabs); vue/no-unused-components covers it.
      'no-unused-vars': 'off'
    }
  },

  // 6. JS/MJS/CJS files: keep Babel parser. The only remaining JS in the
  // source tree is the symbolIcon asset plus this config file. Narrow the
  // JS-file scope to prevent stray .js files in the migrated directories
  // from slipping past the TS lint rules.
  {
    files: [
      'packages/desktop/src/renderer/src/assets/symbolIcon/**/*.js',
      'eslint.config.js'
    ],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        COLAMD_VERSION_STRING: 'readonly',
        COLAMD_VERSION: 'readonly',
        __static: 'readonly'
      }
    },
    rules: {
      '@stylistic/indent': ['error', 2, { SwitchCase: 1, ignoreComments: true }],
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/space-before-function-paren': ['error', 'never'],
      '@stylistic/arrow-parens': 'off',
      '@stylistic/no-mixed-operators': 'off',
      'no-return-await': 'error',
      'no-return-assign': 'error',
      'no-new': 'error',
      'no-console': 'off',
      'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
      'require-atomic-updates': 'off',
      'prefer-const': 'off',
      'no-prototype-builtins': 'off'
    }
  },

  // 7. Test files: add Vitest globals (covers both .js and .ts specs)
  {
    files: ['packages/desktop/test/**/*.js', 'packages/desktop/test/**/*.ts'],
    languageOptions: {
      globals: { ...globals.vitest }
    }
  },

  // 8. JSON validation
  ...pluginJsonc.configs['flat/recommended-with-json'],

  // 9. knip.json is parsed as JSONC by knip itself, so inline comments are
  // legal there (and carry the rationale for each ignore).
  {
    files: ['knip.json'],
    rules: {
      'jsonc/no-comments': 'off'
    }
  },

  // 10. Renderer Node-global guard.
  //
  // The desktop renderer runs with `nodeIntegration: false` plus context
  // isolation, so every Node global is `undefined` there. Referencing one
  // throws a ReferenceError at runtime instead of failing to compile - the
  // bundler has no way to know the identifier does not exist in this world.
  //
  // test/e2e/context-isolation.spec.ts asserts `typeof Buffer ===
  // 'undefined'`, which proves runtime absence but cannot see a static
  // reference. This rule catches the static side.
  //
  // Motivating bug: SAVE_VERSION_SNAPSHOT called Buffer.byteLength() inside
  // FILE_SAVE, so mt::response-file-save was never sent and main never wrote
  // the file. Manual and auto save were both silent no-ops in every
  // production build until the e2e suite caught it.
  //
  // `global` is deliberately NOT listed: vue-i18n is reached via
  // i18n.global, and the practical risk of a bare `global` in a browser
  // context is negligible. `require` is listed even though ESM-only code
  // should not emit it - catching one is a build-system regression worth a
  // loud failure.
  {
    files: [
      'packages/desktop/src/renderer/**/*.ts',
      'packages/desktop/src/renderer/**/*.vue'
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'Buffer',
          message:
            'Buffer is undefined in the renderer (nodeIntegration: false). Use TextEncoder.encode().length for byte lengths, or Uint8Array / window.crypto.subtle.'
        },
        {
          name: 'process',
          message:
            'process is undefined in the renderer. Vite exposes import.meta.env instead.'
        },
        {
          name: '__dirname',
          message: '__dirname is undefined in the renderer.'
        },
        {
          name: '__filename',
          message: '__filename is undefined in the renderer.'
        },
        {
          name: 'require',
          message:
            'require() is unavailable in the renderer. Use a static ESM import instead.'
        }
      ]
    }
  },

  // 11. Main-process `invoke` handlers go through the shared contract.
  //
  // `shared/types/ipc.ts` types the preload side of every channel, but a bare
  // `ipcMain.handle('mt::…', …)` was unchecked: Electron hands the listener
  // `any[]`, so name, argument tuple and return type could drift and only fail
  // at run time. Wrapping registration in `typedHandle` (src/main/ipc/typedHandle.ts)
  // makes the contract load-bearing; this rule stops new bypasses.
  //
  // Converting all 41 channels surfaced eight declarations that were already
  // wrong — e.g. `mt::ask-for-image-path` was typed `string[]` while the handler
  // answers a single path — so the two remaining exemptions below are payload
  // ownership questions, not type errors. See docs/OPTIMIZATION_ROADMAP.md O8.
  {
    files: ['packages/desktop/src/main/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='ipcMain'][callee.property.name='handle']",
          message:
            'Register invoke handlers through typedHandle() from src/main/ipc/typedHandle.ts so the channel stays checked against shared/types/ipc.ts.'
        }
      ]
    }
  },

  // 12. Desktop size gates (O21).
  //
  // The engine package has always warned on `complexity` and
  // `max-lines-per-function`; the desktop package had neither, which is why the
  // oversized functions counted in docs/PROJECT_GUIDE.md §13 — a 313-line Pinia
  // setup, a 279-line onMounted, a 240-line app-ready handler — were never
  // reported by the tooling that should have noticed them. Thresholds sit just
  // above the worst offender that exists today, so the pair warns on nothing
  // until the tree grows past it again; each step of O12 lowers them a notch.
  //
  // 43: measured, not guessed. O12(4) took `LISTEN_FOR_CONTENT_CHANGE` from 44 to
  // 26, and re-probing the package showed the ceiling is now bound by the
  // theme-parsing arrow function in `renderer/src/util/theme.ts`, not by the
  // editor store at all. 277 still binds on the `store/project.ts` setup.
  {
    files: ['packages/desktop/src/**/*.ts', 'packages/desktop/src/**/*.vue'],
    rules: {
      complexity: ['warn', 43],
      'max-lines-per-function': [
        'warn',
        { max: 277, skipBlankLines: true, skipComments: true }
      ]
    }
  }
]
