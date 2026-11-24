import path from 'node:path'
import ts from 'typescript'
import { repositoryRoot } from '../repo/root.mts'
import { walkFiles } from '../repo/walk.mts'

const sourceExtensions = new Set(['.cts', '.mts', '.ts', '.tsx'])
const excludedDirectories = new Set(['.git', 'artifacts', 'dist', 'generated', 'js', 'node_modules', 'vendor'])
const tradingRoots = ['ui/trading', 'shared/trading']

async function collectSourceFiles(directory: string, files: string[]): Promise<void> {
	files.push(...(await walkFiles(directory, { includeNonFiles: true, descend: (_directory, entry) => !excludedDirectories.has(entry.name), include: file => sourceExtensions.has(path.extname(file)) })))
}

function includesBigInt(type: ts.Type): boolean {
	if ((type.flags & ts.TypeFlags.BigIntLike) !== 0) return true
	return type.isUnionOrIntersection() && type.types.some(includesBigInt)
}

function numberCastViolations(program: ts.Program, files: readonly string[]) {
	const checker = program.getTypeChecker()
	const violations: string[] = []
	const scope = new Set(files)
	for (const sourceFile of program.getSourceFiles()) {
		if (sourceFile.isDeclarationFile || !scope.has(sourceFile.fileName)) continue
		function inspect(node: ts.Node): void {
			if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Number' && node.arguments.length > 0) {
				const argument = node.arguments[0]
				if (argument !== undefined && (ts.isBigIntLiteral(argument) || includesBigInt(checker.getTypeAtLocation(argument)))) {
					const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
					violations.push(`${path.relative(repositoryRoot, sourceFile.fileName)}:${(position.line + 1).toString()}`)
				}
			}
			ts.forEachChild(node, inspect)
		}
		inspect(sourceFile)
	}
	return violations
}

function compilerOptions(): ts.CompilerOptions {
	return {
		allowImportingTsExtensions: true,
		jsx: ts.JsxEmit.ReactJSX,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		noEmit: true,
		skipLibCheck: true,
		target: ts.ScriptTarget.ESNext,
	}
}

function validateDetectorFixtures() {
	const sources = new Map([
		['/virtual/ui/forbidden.ts', 'const blockNumber: bigint = 1n\nNumber(blockNumber)'],
		['/virtual/ui/trading/forbidden.ts', 'const reserve = 2n\nNumber(reserve)'],
		['/virtual/shared/trading/forbidden.ts', 'Number(3n)'],
		['/virtual/ui/allowed.ts', "const input: string = '12'\nNumber(input)"],
	])
	const host = ts.createCompilerHost(compilerOptions())
	const originalGetSourceFile = host.getSourceFile
	host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
		const source = sources.get(fileName)
		return source === undefined ? originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) : ts.createSourceFile(fileName, source, languageVersion, true)
	}
	host.fileExists = fileName => sources.has(fileName) || ts.sys.fileExists(fileName)
	host.readFile = fileName => sources.get(fileName) ?? ts.sys.readFile(fileName)
	const files = [...sources.keys()]
	const program = ts.createProgram(files, compilerOptions(), host)
	const tradingFiles = files.filter(file => tradingRoots.some(root => file.startsWith(`/virtual/${root}/`)))
	const scopedViolations = numberCastViolations(program, tradingFiles)
	if (scopedViolations.length !== 2 || !scopedViolations.some(value => value.includes('ui/trading/forbidden.ts')) || !scopedViolations.some(value => value.includes('shared/trading/forbidden.ts'))) throw new Error('Trading Number(bigint) detector fixtures failed')
	if (numberCastViolations(program, files).length !== 3) throw new Error('Repository Number(bigint) detector fixtures failed')
}

validateDetectorFixtures()
const arguments_ = process.argv.slice(2)
const repositoryWide = arguments_[0] === '--repository'
if (arguments_.length !== (repositoryWide ? 1 : 0)) throw new Error('Usage: check-trading-number-casts.mts [--repository]')
const sourceFiles: string[] = []
for (const root of repositoryWide ? ['.'] : tradingRoots) await collectSourceFiles(path.resolve(repositoryRoot, root), sourceFiles)
const violations = numberCastViolations(ts.createProgram(sourceFiles, compilerOptions()), sourceFiles)
const label = repositoryWide ? 'repository' : 'Trading'
if (violations.length > 0) throw new Error(`Direct Number(bigint) casts are forbidden in ${label} TypeScript sources:\n${violations.join('\n')}`)
console.log(`Validated ${sourceFiles.length.toString()} ${label} TypeScript sources contain no direct Number(bigint) casts`)
