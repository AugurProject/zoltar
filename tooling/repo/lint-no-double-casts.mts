import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as ts from 'typescript'
import { listRepositoryFiles } from './git.mts'
import { repositoryRoot } from './root.mts'

export type DoubleCastFinding = {
	readonly column: number
	readonly file: string
	readonly line: number
}

/** The single module allowed to widen through `unknown`: it holds only the `testDouble` helper every UI test stand-in goes through. */
export const sanctionedDoubleCastFiles: ReadonlySet<string> = new Set(['ui/coreShared/ts/tests/testUtils/testDouble.ts'])

const typeScriptSource = /\.(?:[cm]?ts|tsx)$/
const excludedSegment = /(?:^|\/)(?:artifacts|dist|generated|js|node_modules|vendor)\//
const excludedFile = /\.(?:generated\.[cm]?tsx?|d\.[cm]?ts)$/

export const isDoubleCastCheckedSource = (file: string): boolean => typeScriptSource.test(file) && !excludedSegment.test(file) && !excludedFile.test(file) && !sanctionedDoubleCastFiles.has(file)

const unwrapParentheses = (expression: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(expression) ? unwrapParentheses(expression.expression) : expression)

const isEscapeHatchType = (type: ts.TypeNode): boolean => type.kind === ts.SyntaxKind.UnknownKeyword || type.kind === ts.SyntaxKind.AnyKeyword

/** Reports `value as unknown as T` and `value as any as T`: a cast laundered through a type that accepts everything. */
export function findDoubleCasts(file: string, source: string): DoubleCastFinding[] {
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
	const findings: DoubleCastFinding[] = []
	const visit = (node: ts.Node): void => {
		if (ts.isAsExpression(node)) {
			const inner = unwrapParentheses(node.expression)
			if (ts.isAsExpression(inner) && isEscapeHatchType(inner.type)) {
				const position = sourceFile.getLineAndCharacterOfPosition(node.getStart())
				findings.push({ column: position.character + 1, file, line: position.line + 1 })
			}
		}
		ts.forEachChild(node, visit)
	}
	visit(sourceFile)
	return findings
}

export function inspectDoubleCasts(sources: ReadonlyMap<string, string>): DoubleCastFinding[] {
	const findings: DoubleCastFinding[] = []
	for (const [file, source] of sources) if (isDoubleCastCheckedSource(file)) findings.push(...findDoubleCasts(file, source))
	return findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column)
}

function trackedSources(root: string): Map<string, string> {
	const sources = new Map<string, string>()
	for (const file of listRepositoryFiles({ cwd: root }).filter(isDoubleCastCheckedSource)) {
		try {
			sources.set(file, readFileSync(path.join(root, file), 'utf8'))
		} catch (error) {
			// Git still lists unstaged deletions; a deleted source has nothing to inspect.
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
			throw error
		}
	}
	return sources
}

if (import.meta.main) {
	const findings = inspectDoubleCasts(trackedSources(repositoryRoot))
	for (const finding of findings) console.log(`${finding.file}:${finding.line.toString()}:${finding.column.toString()} - Unexpected double cast through unknown or any`)
	if (findings.length !== 0) {
		console.log(`\nFound ${findings.length.toString()} double cast(s). Narrow the value or validate it at runtime; a test stand-in for a larger interface goes through testDouble.`)
		process.exitCode = 1
	}
}
