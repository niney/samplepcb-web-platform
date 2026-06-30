import base from './base.js';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import tseslint from 'typescript-eslint';

// Vue SFC 린트: <template> 는 vue-eslint-parser, <script> 는 ts parser.
export default [
  ...base,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      // 페이지 컴포넌트는 단어 1개 허용
      'vue/multi-word-component-names': 'off',
      // 포맷은 prettier가 담당 — vue 포맷 규칙 비활성(충돌 방지)
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
    },
  },
];
