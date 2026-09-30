import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { findGeneratedPolicyViolations, type GeneratedPolicyQueries, gitGeneratedPolicyQueries, parseGitattributes } from './check-generated-policy.mts'
import type { GeneratedArtifact } from './generated-artifacts.ts'
import { repositoryRoot } from './root.mts'

const registry: readonly GeneratedArtifact[] = [
	{ pattern: 'app/js/**', tracked: false, regenerate: 'bun run build', linguist: 'generated' },
	{ pattern: 'app/.hash', tracked: false, regenerate: 'bun run build' },
	{ pattern: 'docs/assets/*.js', tracked: true, regenerate: 'bun run docs:build', reason: 'The static site loads it.', check: 'bun run docs:check', linguist: 'generated' },
]

const validAttributes = `# comment
/app/js/** linguist-generated=true
/docs/assets/*.js linguist-generated=true
/vendor/** linguist-vendored=true
*.sol text eol=lf
`

const trackedFilesByPathspec: Record<string, readonly string[]> = {
	':(glob)docs/assets/*.js': ['docs/assets/runtime.js'],
	':(glob)vendor/**': ['vendor/lib.sol'],
	':(glob)**/*.sol': ['vendor/lib.sol'],
}

const queries = (overrides: Partial<GeneratedPolicyQueries> = {}): GeneratedPolicyQueries => ({
	trackedFiles: pathspec => trackedFilesByPathspec[pathspec] ?? [],
	ignoredPaths: paths => new Set(paths),
	...overrides,
})

describe('generated-output policy', () => {
	test('parses set, unset, and valued attributes', () => {
		expect(parseGitattributes('# skip\n\n/a/** linguist-generated=true -diff text\n').map(rule => [rule.line, rule.pattern, [...rule.attributes]])).toEqual([
			[
				3,
				'/a/**',
				[
					['linguist-generated', 'true'],
					['diff', 'false'],
					['text', 'true'],
				],
			],
		])
	})

	test('accepts attributes and ignore rules that match the registry', () => {
		expect(findGeneratedPolicyViolations(validAttributes, queries(), registry)).toEqual([])
	})

	test('rejects linguist-generated paths that are not registered outputs', () => {
		expect(findGeneratedPolicyViolations(`${validAttributes}/ui/js/** linguist-generated=true\n`, queries(), registry)).toEqual(['.gitattributes:6 marks /ui/js/** linguist-generated, but tooling/repo/generated-artifacts.ts does not register it as a generated output'])
	})

	test('rejects attribute patterns that match nothing', () => {
		expect(findGeneratedPolicyViolations(`${validAttributes}/retired/** linguist-vendored=true\n`, queries(), registry)).toEqual(['.gitattributes:6 references /retired/**, which matches no tracked file and no registered generated output'])
	})

	test('rejects repeated patterns', () => {
		expect(findGeneratedPolicyViolations(`${validAttributes}*.sol linguist-vendored=true\n`, queries(), registry)).toEqual(['.gitattributes:6 repeats the pattern *.sol from line 5; combine its attributes on one line'])
	})

	test('requires every tracked output to be marked and to exist', () => {
		const attributes = validAttributes.replace('/docs/assets/*.js linguist-generated=true\n', '')
		expect(findGeneratedPolicyViolations(attributes, queries({ trackedFiles: pathspec => (pathspec === ':(glob)docs/assets/*.js' ? [] : (trackedFilesByPathspec[pathspec] ?? [])) }), registry)).toEqual([
			'.gitattributes must mark /docs/assets/*.js linguist-generated=true',
			'Tracked generated output docs/assets/*.js matches no tracked file; remove it from the registry or restore the output',
		])
	})

	test('rejects tracked or unignored untracked outputs', () => {
		const violations = findGeneratedPolicyViolations(validAttributes, queries({ trackedFiles: pathspec => (pathspec === ':(glob)app/js/**' ? ['app/js/index.js'] : (trackedFilesByPathspec[pathspec] ?? [])), ignoredPaths: () => new Set(['app/js/sample']) }), registry)
		expect(violations).toEqual(['Untracked generated output app/js/** has tracked files: app/js/index.js', '.gitignore does not ignore the generated output app/.hash'])
	})

	test('reports ignored paths through git check-ignore, excluding negated rules', () => {
		const ignored = gitGeneratedPolicyQueries().ignoredPaths(['solidity/artifacts/sample', 'solidity/ts/types/index.d.ts', 'tooling/repo/sample.ts'])
		expect([...ignored]).toEqual(['solidity/artifacts/sample'])
	})

	test('the repository registry matches .gitattributes, .gitignore, and the Git index', () => {
		expect(findGeneratedPolicyViolations(readFileSync(path.join(repositoryRoot, '.gitattributes'), 'utf8'), gitGeneratedPolicyQueries())).toEqual([])
	})
})
