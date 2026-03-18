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

		// Disallow the use of any type
		'@typescript-eslint/no-explicit-any': 'error',

		'local/single-line-switch-case': 'error',

		'unused-imports/no-unused-imports': 'error',
		'unused-imports/no-unused-exports': 'error',
	},
	settings: {
		// Resolve imports relative to tsconfig paths if needed
	},
	ignorePatterns: ['node_modules/', 'dist/', 'js/', '**/*.js'],
}
