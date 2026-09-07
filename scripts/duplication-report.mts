import { duplicationSourcePaths, isDuplicationTest } from './duplication-scope.mts'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as ts from 'typescript'
import { parseSource } from './lint-source-files.mts'

// Development-only, exact function-body report. No CI threshold or automatic baseline updates.
const root = resolve(import.meta.dir, '..')
const paths = duplicationSourcePaths(root)
const groups = new Map<string, { fingerprint: string; tokens: number; occurrences: { path: string; line: number; test: boolean }[] }>()
for (const path of paths) {
	const source = parseSource(path, await readFile(resolve(root, path), 'utf8'))
	const visit = (node: ts.Node): void => {
		if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) && node.body !== undefined) {
			const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, node.body.getText(source))
			const tokens: string[] = []
			while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) tokens.push(scanner.getTokenText())
			if (tokens.length >= 100) {
				const fingerprint = createHash('sha256').update(JSON.stringify(tokens)).digest('hex')
				const group = groups.get(fingerprint) ?? { fingerprint, tokens: tokens.length, occurrences: [] }
				group.occurrences.push({ path, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, test: isDuplicationTest(path) })
				groups.set(fingerprint, group)
			}
		}
		ts.forEachChild(node, visit)
	}
	visit(source)
}
const duplicates = [...groups.values()].filter(group => group.occurrences.length > 1).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))
const baseline: unknown = JSON.parse(await readFile(resolve(root, 'scripts/duplication-baseline.json'), 'utf8'))
if (typeof baseline !== 'object' || baseline === null || !('fingerprints' in baseline) || !Array.isArray(baseline.fingerprints) || !baseline.fingerprints.every((value: unknown) => typeof value === 'string')) throw new Error('Invalid duplication baseline fingerprints')
const known = new Set(baseline.fingerprints)
console.log(
	JSON.stringify(
		{
			mode: 'report-only',
			method: 'Exact function bodies, comments/whitespace ignored, identifiers/literals preserved, minimum 100 tokens; not a semantic or whole-repository clone detector.',
			source: duplicates.filter(group => group.occurrences.every(item => !item.test)).map(group => ({ ...group, baseline: known.has(group.fingerprint) })),
			tests: duplicates.filter(group => group.occurrences.some(item => item.test)).map(group => ({ ...group, baseline: known.has(group.fingerprint) })),
			resolvedBaseline: baseline.fingerprints.filter(fingerprint => !duplicates.some(group => group.fingerprint === fingerprint)),
		},
		undefined,
		2,
	),
)
