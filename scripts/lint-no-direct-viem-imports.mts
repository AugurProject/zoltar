import * as path from 'node:path'
import * as url from 'node:url'
import * as ts from 'typescript'

type DirectViemImportFinding = {
	file: string
	importText: string
	line: number
	column: number
}

const repositoryRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const formatDiagnosticsHost: ts.FormatDiagnosticsHost = {
	getCanonicalFileName: fileName => fileName,
	getCurrentDirectory: () => repositoryRoot,
	getNewLine: () => ts.sys.newLine,
}

function toProjectPath(filePath: string): string {
	return path.relative(repositoryRoot, filePath).replaceAll('\\', '/')
}

function shouldCheckSourceFile(sourceFile: ts.SourceFile): boolean {
	if (sourceFile.isDeclarationFile) return false
	const relativePath = toProjectPath(sourceFile.fileName)
	if (relativePath.startsWith('node_modules/') || relativePath.includes('/node_modules/')) return false
	if (relativePath.startsWith('ui/vendor/') || relativePath.startsWith('ui/js/') || relativePath.startsWith('shared/js/') || relativePath.startsWith('solidity/js/')) return false
	return relativePath.endsWith('.ts') || relativePath.endsWith('.tsx') || relativePath.endsWith('.mts') || relativePath.endsWith('.cts')
}

function findDirectViemImportFindings(sourceFile: ts.SourceFile): DirectViemImportFinding[] {
	const findings: DirectViemImportFinding[] = []

	function visit(node: ts.Node): void {
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'viem') {
			const position = sourceFile.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart(sourceFile))
			findings.push({
				file: toProjectPath(sourceFile.fileName),
				importText: node.getText(sourceFile),
				line: position.line + 1,
				column: position.character + 1,
			})
		}

		ts.forEachChild(node, visit)
	}

	visit(sourceFile)
	return findings
}

const configPath = ts.findConfigFile(repositoryRoot, ts.sys.fileExists, 'tsconfig.json')
if (configPath === undefined) {
	console.log('Unable to find tsconfig.json.')
	process.exit(1)
}

const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
if (configFile.error !== undefined) {
	console.log(ts.formatDiagnosticsWithColorAndContext([configFile.error], formatDiagnosticsHost))
	process.exit(1)
}

const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath), undefined, configPath)
if (parsedConfig.errors.length > 0) {
	console.log(ts.formatDiagnosticsWithColorAndContext(parsedConfig.errors, formatDiagnosticsHost))
	process.exit(1)
}

const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options)
const findings = program.getSourceFiles().filter(shouldCheckSourceFile).flatMap(findDirectViemImportFindings)

if (findings.length > 0) {
	console.log("Direct 'viem' imports are not allowed outside the shared Ethereum wrapper. Import from '@zoltar/shared/ethereum' instead.")
	for (const finding of findings) {
		console.log(`${finding.file}:${finding.line}:${finding.column} - ${finding.importText}`)
	}
	console.log(`\nFound ${findings.length} direct 'viem' import(s).`)
	process.exitCode = 1
}
