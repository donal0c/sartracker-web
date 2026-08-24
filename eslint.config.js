import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'playwright-report',
    'test-results',
    'output/**',
    'spikes/**',
    'tmp/**',
    'var/**',
    'src-tauri/target/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    files: ['src/**/*.{js,cjs,mjs,ts,tsx}', 'electron/**/*.{js,cjs,mjs,ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/tools/coverage-renderer-bench/**', '**/build/coverage-bench-lib.js'],
          message: 'The G2 coverage renderer harness is non-production evidence tooling.',
        }],
      }],
    },
  },
])
