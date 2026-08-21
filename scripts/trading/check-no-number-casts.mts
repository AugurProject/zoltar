import { readdir } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

const repositoryRoot = path.resolve(import.meta.dir, '../..')
const sourceExtensions = new Set(['.cts', '.mts', '.ts', '.tsx'])
const excludedDirectories = new Set(['.git', 'artifacts', 'dist', 'generated', 'js', 'node_modules', 'vendor'])

async function collectSourceFiles(directory: string, files: string[]): Promise<void> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue
		const child = path.join(directory, entry.name)
		if (entry.isDirectory()) await collectSourceFiles(child, files)
		else if (sourceExtensions.has(path.extname(entry.name))) files.push(child)
	}
}

function includesBigInt(type: ts.Type): boolean {
	if ((type.flags & ts.TypeFlags.BigIntLike) !== 0) return true
	return type.isUnionOrIntersection() && type.types.some(includesBigInt)
}

function numberCastViolations(program: ts.Program) {
	const checker = program.getTypeChecker()
	const violations: string[] = []
	for (const sourceFile of program.getSourceFiles()) {
		if (sourceFile.isDeclarationFile) continue
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
	const violations = numberCastViolations(ts.createProgram([...sources.keys()], compilerOptions(), host))
	if (violations.length !== 2 || !violations.some(value => value.includes('ui/forbidden.ts')) || !violations.some(value => value.includes('ui/trading/forbidden.ts'))) throw new Error('Number(bigint) detector fixtures failed')
}

validateDetectorFixtures()
const sourceFiles: string[] = []
await collectSourceFiles(repositoryRoot, sourceFiles)
const violations = numberCastViolations(ts.createProgram(sourceFiles, compilerOptions()))
if (violations.length > 0) throw new Error(`Direct Number(bigint) casts are forbidden in repository TypeScript sources:\n${violations.join('\n')}`)
console.log(`Validated ${sourceFiles.length.toString()} repository TypeScript sources contain no direct Number(bigint) casts`)
