module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	parserOptions: {
		project: ['./ts/tsconfig.json'],
		tsconfigRootDir: __dirname,
		sourceType: 'module',
	},
	plugins: ['@typescript-eslint', 'unused-imports', 'local'],
	extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
	rules: {
		// Indentation: use tabs
		indent: ['error', 'tab'],

		// String quotes: single quotes
		quotes: ['error', 'single', { avoidEscape: true }],

		// Semicolons: never
		semi: ['error', 'never'],

		// Spacing inside template curly braces
		'template-curly-spacing': ['error', 'always'],

		// Disallow multiple empty lines
		'no-multiple-empty-lines': ['error', { max: 1 }],

		// Disallow the use of any type
		'@typescript-eslint/no-explicit-any': 'error',

		'local/single-line-switch-case': 'error',

		'unused-imports/no-unused-imports': 'error',
		'unused-imports/no-unused-exports': 'error',
		'unused-imports/no-unused-vars': [
			'error',
			{
				vars: 'all',
				args: 'none',
				ignoreRestSiblings: true,
				varsIgnorePattern: '^_',
				argsIgnorePattern: '^_',
			},
		],

		// Disallow non-null assertion operator - use explicit checks instead
		'no-restricted-syntax': [
			'error',
			{
				selector: 'TSNonNullExpression',
				message: 'Unexpected non-null assertion. Perform explicit undefined checks and throw an error if needed.',
			},
		],
	},
	settings: {
		// Resolve imports relative to tsconfig paths if needed
	},
	ignorePatterns: ['node_modules/', 'dist/', 'js/', '**/*.js'],
}
