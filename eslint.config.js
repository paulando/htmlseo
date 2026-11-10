import js from '@eslint/js';
import globals from 'globals';

const INJECTED_RULE = {
    'no-restricted-syntax': ['error',
        {
            selector: "Program > VariableDeclaration[kind!='var']",
            message: 'Files injected into pages run repeatedly in the same world: no top-level const/let (wrap in a function).',
        },
        {
            selector: 'Program > ClassDeclaration',
            message: 'Files injected into pages run repeatedly in the same world: no top-level class.',
        },
    ],
};

export default [
    { ignores: ['node_modules/', 'test-results/', 'playwright-report/', 'dist/', 'design_inspirations/'] },
    js.configs.recommended,
    {
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: { ...globals.browser, ...globals.webextensions },
        },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
            'no-empty': ['error', { allowEmptyCatch: true }],
            eqeqeq: ['error', 'smart'],
            'prefer-const': 'error',
        },
    },
    // Classic (non-module) scripts: content scripts, service worker, page-injected files.
    {
        files: ['analyzer.js', 'overlay.js', 'content.js', 'background.js', 'test/chrome-stub.js'],
        languageOptions: { sourceType: 'script' },
    },
    { files: ['analyzer.js', 'overlay.js'], rules: INJECTED_RULE },
    { files: ['analyzer.js'], rules: { 'no-unused-vars': ['error', { varsIgnorePattern: '^analyzePage$' }] } },
    { files: ['content.js'], languageOptions: { globals: { analyzePage: 'readonly' } } },
    {
        files: ['test/**/*.js', 'test/**/*.mjs', 'scripts/**/*.mjs', '*.config.js'],
        ignores: ['test/chrome-stub.js'],
        languageOptions: { globals: { ...globals.node, analyzePage: 'readonly' } },
    },
];
