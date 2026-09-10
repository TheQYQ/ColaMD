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
      '**/playwright-report/**'
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
      'vue/require-default-prop': 'off'
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
  }
]
