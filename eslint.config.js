import ts from '@typescript-eslint/eslint-plugin'
import parser from '@typescript-eslint/parser'
import unusedExports from 'eslint-plugin-unused-imports'
import globals from 'globals'

export default [
	{
		files: ['solidity/ts/**/*.ts'],
		languageOptions: {
			parser,
			parserOptions: {
				project: ['./tsconfig.json'],
				sourceType: 'module',
			},
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		plugins: {
			'@typescript-eslint': ts,
			'unused-imports': unusedExports,
		},
		rules: {
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

			'arrow-body-style': ['error', 'as-needed'],

			// Disallow non-null assertion operator - use explicit checks instead
			'no-restricted-syntax': [
				'error',
				{
					selector: 'TSNonNullExpression',
					message: 'Unexpected non-null assertion. Perform explicit undefined checks and throw an error if needed.',
				},
			],

			// Disallow multiple empty lines
			'no-multiple-empty-lines': ['error', { max: 1 }],

			// Spacing inside template curly braces
			'template-curly-spacing': ['error', 'always'],
		},
	},
	{
		// Disable no-explicit-any for files that require any
		files: [
			'solidity/ts/types/index.d.ts',
			'solidity/ts/testsuite/simulator/utils/bigint.ts',
			'solidity/ts/testsuite/simulator/AnvilWindowEthereum.ts',
		],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
	{
		ignores: ['node_modules/**', 'dist/**', 'js/**', '**/*.js', '**/*.mjs', '**/*.cjs', 'tests/**'],
	},
]
