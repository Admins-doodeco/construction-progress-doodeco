const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'indent': ['error', 2],
      'linebreak-style': ['error', 'unix'],
      'quotes': ['error', 'single'],
      'semi': ['error', 'always'],
      'no-unused-vars': ['warn', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_' }],
      'no-console': 'off',
    },
  },
  {
    files: ['check.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        Vue: 'readonly',
      },
    },
  },
  {
    ignores: [
      'node_modules/',
      '*.db',
      '*.log',
      'dist/',
      'build/',
      '.env',
    ],
  },
];
