import { expect, test } from 'bun:test'
import * as path from 'node:path'
import * as ts from 'typescript'
import { inspectSignalComparisons } from './lint-no-signal-wrapper-comparisons.mts'
import { repositoryRoot } from './root.mts'

const options: ts.CompilerOptions = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true, strict: true, target: ts.ScriptTarget.ESNext, types: [] }

/** Type-checks one in-memory source as if it lived at the given repository path, resolving real dependencies from disk. */
function inspectVirtualSource(relativePath: string, source: string) {
	const virtualPath = path.join(repositoryRoot, relativePath)
	const host = ts.createCompilerHost(options)
	const readFromDisk = host.getSourceFile.bind(host)
	const existsOnDisk = host.fileExists.bind(host)
	const readTextFromDisk = host.readFile.bind(host)
	host.getSourceFile = (fileName, languageVersion, ...rest) => (fileName === virtualPath ? ts.createSourceFile(fileName, source, languageVersion, true) : readFromDisk(fileName, languageVersion, ...rest))
	host.fileExists = fileName => fileName === virtualPath || existsOnDisk(fileName)
	host.readFile = fileName => (fileName === virtualPath ? source : readTextFromDisk(fileName))
	return inspectSignalComparisons(ts.createProgram([virtualPath], options, host))
}

const signalSource = [
	"import { type Signal, signal } from '@preact/signals'",
	'const count = signal<number | undefined>(undefined)',
	'export const wrapperIsMissing = count === undefined',
	'export const wrapperIsNull = null != count',
	'export const valueIsMissing = count.value === undefined',
	'export const optionalWrapperIsMissing = (maybe: Signal<number> | undefined) => maybe === undefined',
	'',
].join('\n')

test('signal wrappers compared to undefined or null are reported with the compared expression', () => {
	const file = 'ui/coreShared/ts/signalComparisonFixture.ts'
	expect(inspectVirtualSource(file, signalSource)).toEqual([
		{ column: 33, expression: 'count === undefined', file, line: 3 },
		{ column: 38, expression: 'null != count', file, line: 4 },
	])
})

test('sources outside the UI packages are not inspected', () => {
	expect(inspectVirtualSource('tooling/repo/signalComparisonFixture.ts', signalSource)).toEqual([])
})
