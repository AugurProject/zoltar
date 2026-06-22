import * as path from 'node:path'
import * as url from 'node:url'
import * as ts from 'typescript'

type SignalComparisonFinding = {
	file: string
	line: number
	column: number
	expression: string
}

const repositoryRoot = path.dirname(url.fileURLToPath(import.meta.url))
const projectRoot = path.join(repositoryRoot, '..')
const formatDiagnosticsHost: ts.FormatDiagnosticsHost = {
	getCanonicalFileName: fileName => fileName,
	getCurrentDirectory: () => projectRoot,
	getNewLine: () => ts.sys.newLine,
}

function toProjectPath(filePath: string): string {
	return path.relative(projectRoot, filePath).replaceAll('\\', '/')
}

function shouldCheckSourceFile(sourceFile: ts.SourceFile): boolean {
	if (sourceFile.isDeclarationFile) return false
	const relativePath = toProjectPath(sourceFile.fileName)
	return relativePath.startsWith('ui/ts/') && (relativePath.endsWith('.ts') || relativePath.endsWith('.tsx'))
}

function isEqualityOperator(kind: ts.SyntaxKind): boolean {
	switch (kind) {
		case ts.SyntaxKind.EqualsEqualsToken:
		case ts.SyntaxKind.ExclamationEqualsToken:
		case ts.SyntaxKind.EqualsEqualsEqualsToken:
		case ts.SyntaxKind.ExclamationEqualsEqualsToken:
			return true
		default:
			return false
	}
}

function isNullishExpression(node: ts.Expression): boolean {
	return node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === 'undefined')
}

function isNullishType(type: ts.Type): boolean {
	return (type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0
}

function isPreactSignalDeclaration(declaration: ts.Declaration): boolean {
	const fileName = declaration.getSourceFile().fileName.replaceAll('\\', '/')
	return fileName.includes('/node_modules/@preact/signals/') || fileName.includes('/node_modules/@preact/signals-core/')
}

function isPreactSignalType(type: ts.Type): boolean {
	if (type.isUnion()) {
		if (type.types.some(isNullishType)) return false
		return type.types.some(isPreactSignalType)
	}

	const valueProperty = type.getProperty('value')
	if (valueProperty === undefined) return false

	const declarations = valueProperty.getDeclarations()
	return declarations !== undefined && declarations.some(isPreactSignalDeclaration)
}

function formatExpression(sourceFile: ts.SourceFile, node: ts.Node): string {
	const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
	const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line
	if (startLine === endLine) return node.getText(sourceFile)

	const firstLine = sourceFile.text.split('\n')[startLine]
	return firstLine === undefined ? node.getText(sourceFile) : firstLine.trim()
}

function findComparedSignalExpression(node: ts.BinaryExpression, checker: ts.TypeChecker): ts.Expression | undefined {
	if (isNullishExpression(node.left) && isPreactSignalType(checker.getTypeAtLocation(node.right))) return node.right
	if (isNullishExpression(node.right) && isPreactSignalType(checker.getTypeAtLocation(node.left))) return node.left
	return undefined
}

function findSignalComparisonFindings(sourceFile: ts.SourceFile, checker: ts.TypeChecker): SignalComparisonFinding[] {
	const findings: SignalComparisonFinding[] = []

	function visit(node: ts.Node): void {
		if (ts.isBinaryExpression(node) && isEqualityOperator(node.operatorToken.kind)) {
			const signalExpression = findComparedSignalExpression(node, checker)
			if (signalExpression !== undefined) {
				const position = sourceFile.getLineAndCharacterOfPosition(signalExpression.getStart(sourceFile))
				findings.push({
					file: toProjectPath(sourceFile.fileName),
					line: position.line + 1,
					column: position.character + 1,
					expression: formatExpression(sourceFile, node),
				})
			}
		}

		ts.forEachChild(node, visit)
	}

	visit(sourceFile)
	return findings
}

const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json')
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
const checker = program.getTypeChecker()
const findings = program
	.getSourceFiles()
	.filter(shouldCheckSourceFile)
	.flatMap(sourceFile => findSignalComparisonFindings(sourceFile, checker))

if (findings.length > 0) {
	console.log('Signal wrappers must not be compared directly to undefined or null. Compare the signal value instead.')
	for (const finding of findings) {
		console.log(`${finding.file}:${finding.line}:${finding.column} - ${finding.expression}`)
	}
	console.log(`\nFound ${findings.length} direct signal wrapper comparison(s).`)
	process.exitCode = 1
}
