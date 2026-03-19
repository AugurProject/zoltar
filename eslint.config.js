import ts from '@typescript-eslint/eslint-plugin'
import parser from '@typescript-eslint/parser'
import unusedExports from 'eslint-plugin-unused-imports'
import globals from 'globals'

const commonLanguageOptions = {
	parser,
	parserOptions: {
		project: ['./tsconfig.json'],
		sourceType: 'module',
	},
	globals: {
		...globals.browser,
		...globals.node,
	},
}

const commonPlugins = {
	'@typescript-eslint': ts,
	'unused-imports': unusedExports,
}

const commonRules = {
	// Let Prettier handle formatting; only enforce rules not covered by Prettier

	// Disallow any
	'@typescript-eslint/no-explicit-any': 'error',
	'@typescript-eslint/explicit-function-return-type': 'off',
	'@typescript-eslint/naming-convention': 'off',
	// Allow flexible parentheses in expressions
	'@typescript-eslint/no-extra-parens': 'off',

	// Unused imports
	'unused-imports/no-unused-imports': 'error',
	'unused-imports/no-unused-vars': [
		'warn',
		{
			vars: 'all',
			varsIgnorePattern: '^_',
			args: 'after-used',
			argsIgnorePattern: '^_',
		},
	],

	// Quality of life
	'prefer-const': 'error',
	'no-else-return': 'error',
	curly: ['error', 'multi-line'],
	eqeqeq: 'error',
	'no-console': 'off',

	'@typescript-eslint/no-unnecessary-type-assertion': 'error',
	'@typescript-eslint/no-floating-promises': 'error',
	'@typescript-eslint/await-thenable': 'error',
	'@typescript-eslint/no-non-null-assertion': 'error',

	'arrow-body-style': ['error', 'as-needed'],

	// Disallow multiple empty lines
	'no-multiple-empty-lines': ['error', { max: 1 }],

	// Disallow consecutive spaces (no two spaces in a row)
	'no-multi-spaces': 'error',

	// Spacing inside template curly braces
	'template-curly-spacing': ['error', 'always'],
}

export default [
	// All other TypeScript files in the solidity project
	{
		files: ['solidity/ts/**/*.ts'],
		languageOptions: commonLanguageOptions,
		plugins: commonPlugins,
		rules: commonRules,
	},
	// Ignore patterns
	{
		ignores: [
			'node_modules/**',
			'dist/**',
			'js/**',
			'**/*.js',
			'**/*.mjs',
			'**/*.cjs',
		],
	},
]
