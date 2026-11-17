import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as ts from 'typescript'
import { listRepositoryFiles } from './git.mts'
import { repositoryRoot } from './root.mts'

export type RenderedNullFinding = {
	readonly column: number
	readonly file: string
	readonly line: number
}

const componentSource = /^ui\/[^/]+\/ts\/.+\.tsx$/
const excludedSegment = /\/(?:generated|js|tests?|vendor)\//
/** Callees whose own contract takes `null`; passing it there forwards an external contract rather than producing state. */
const nullAcceptingCallees = new Set(['useRef', 'createRef', 'stringify', 'replaceState', 'pushState'])
const comparisonOperators = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken])

/** UI component sources: the files where a `null` value is a rendering choice rather than an external contract. */
export const isComponentSource = (file: string): boolean => componentSource.test(file) && !excludedSegment.test(file) && !/\.test\.tsx$/.test(file)

/**
 * A `null` that the code only reads or forwards belongs to an external contract: a type annotation, a comparison
 * against a DOM or storage result, or an argument to a call whose contract takes `null`, such as `useRef(null)`.
 * Every other `null`, including one passed to a state setter, is a value the component chose to produce, where the
 * repository convention is `undefined`.
 */
const isExternalContractNull = (node: ts.Node): boolean => {
	const parent = node.parent
	if (ts.isLiteralTypeNode(parent)) return true
	if (ts.isBinaryExpression(parent) && comparisonOperators.has(parent.operatorToken.kind)) return true
	if (!ts.isCallExpression(parent) || !parent.arguments.some(argument => argument === node)) return false
	const callee = parent.expression
	if (ts.isIdentifier(callee)) return nullAcceptingCallees.has(callee.text)
	return ts.isPropertyAccessExpression(callee) && nullAcceptingCallees.has(callee.name.text)
}

export function findRenderedNulls(file: string, source: string): RenderedNullFinding[] {
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
	const findings: RenderedNullFinding[] = []
	const visit = (node: ts.Node): void => {
		if (node.kind === ts.SyntaxKind.NullKeyword && !isExternalContractNull(node)) {
			const position = sourceFile.getLineAndCharacterOfPosition(node.getStart())
			findings.push({ column: position.character + 1, file, line: position.line + 1 })
		}
		ts.forEachChild(node, visit)
	}
	visit(sourceFile)
	return findings
}

export function inspectRenderedNulls(sources: ReadonlyMap<string, string>): RenderedNullFinding[] {
	const findings: RenderedNullFinding[] = []
	for (const [file, source] of sources) if (isComponentSource(file)) findings.push(...findRenderedNulls(file, source))
	return findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column)
}

function trackedComponentSources(root: string): Map<string, string> {
	const sources = new Map<string, string>()
	for (const file of listRepositoryFiles({ cwd: root }).filter(isComponentSource)) {
		try {
			sources.set(file, readFileSync(path.join(root, file), 'utf8'))
		} catch (error) {
			// Git still lists unstaged deletions; a deleted component has nothing to inspect.
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
			throw error
		}
	}
	return sources
}

if (import.meta.main) {
	const findings = inspectRenderedNulls(trackedComponentSources(repositoryRoot))
	for (const finding of findings) console.log(`${finding.file}:${finding.line.toString()}:${finding.column.toString()} - Unexpected null value in a UI component; render or return undefined instead`)
	if (findings.length !== 0) {
		console.log(`\nFound ${findings.length.toString()} null value(s) produced by UI components. Use undefined for absence; null is reserved for external APIs and schemas.`)
		process.exitCode = 1
	}
}
