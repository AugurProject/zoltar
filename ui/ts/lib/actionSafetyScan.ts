import * as path from 'node:path'
import * as url from 'node:url'
import * as ts from 'typescript'
import { ACTION_SAFETY_MANIFEST } from './actionSafety/manifest.js'

type ActionSafetyFinding = {
	column: number
	file: string
	line: number
	message: string
}

type ScanActionSafetySourcesOptions = {
	configPath?: string
	repositoryRoot?: string
}

const defaultRepositoryRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../../../')
const defaultUiTsConfigPath = path.join(defaultRepositoryRoot, 'ui', 'tsconfig.json')
const manifestIds = new Set<string>(ACTION_SAFETY_MANIFEST.map(entry => entry.id))
const allowedSafetyIdHelpers = new Set(['getDeploymentStepSafetyId', 'getForkAuctionActionSafetyId', 'getOpenOracleActionSafetyId', 'getReportingActionSafetyId', 'getSecurityPoolOverviewActionSafetyId', 'getSecurityVaultActionSafetyId', 'getTradingActionSafetyId'])
const bannedActionSafetyCallPrefixes = ['load', 'quote', 'read', 'send', 'simulate', 'write']
const generatedUiFiles = new Set(['ui/ts/abis.ts', 'ui/ts/contractArtifact.ts', 'ui/ts/deploymentArtifacts.ts', 'ui/ts/deploymentsArtifacts.ts'])
const safetyFunctionNamePattern = /(GuardMessage|Readiness|Availability)/

function toRelativePath(filePath: string, repositoryRoot: string) {
	return path.relative(repositoryRoot, filePath).replaceAll('\\', '/')
}

function isProductionUiSourcePath(relativePath: string) {
	return relativePath.startsWith('ui/ts/') && !relativePath.startsWith('ui/ts/tests/') && !relativePath.startsWith('ui/js/') && !generatedUiFiles.has(relativePath)
}

function getLineAndColumn(sourceFile: ts.SourceFile, node: ts.Node) {
	const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
	return {
		column: position.character + 1,
		line: position.line + 1,
	}
}

function getJsxAttribute(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) {
	for (const property of node.attributes.properties) {
		if (!ts.isJsxAttribute(property)) continue
		if (!ts.isIdentifier(property.name)) continue
		if (property.name.text !== name) continue

		return property
	}

	return undefined
}

function getResolvedSymbol(symbol: ts.Symbol, checker: ts.TypeChecker) {
	let currentSymbol = symbol
	while ((currentSymbol.flags & ts.SymbolFlags.Alias) !== 0) {
		const nextSymbol = checker.getAliasedSymbol(currentSymbol)
		if (nextSymbol === currentSymbol) break
		currentSymbol = nextSymbol
	}

	return currentSymbol
}

function getSymbolDeclarationPath(symbol: ts.Symbol, repositoryRoot: string) {
	const declarationPaths = symbol.declarations?.map(declaration => toRelativePath(declaration.getSourceFile().fileName, repositoryRoot)) ?? []
	for (const declarationPath of declarationPaths) {
		if (isProductionUiSourcePath(declarationPath)) return declarationPath
	}

	return declarationPaths[0]
}

function unwrapSafetyExpression(expression: ts.Expression): ts.Expression {
	if (ts.isParenthesizedExpression(expression)) return unwrapSafetyExpression(expression.expression)
	if (ts.isAsExpression(expression)) return unwrapSafetyExpression(expression.expression)
	if (ts.isTypeAssertionExpression(expression)) return unwrapSafetyExpression(expression.expression)
	if (ts.isNonNullExpression(expression)) return unwrapSafetyExpression(expression.expression)
	return expression
}

function getExpressionName(expression: ts.Expression): string | undefined {
	if (ts.isIdentifier(expression)) return expression.text
	if (ts.isPropertyAccessExpression(expression)) return expression.name.text
	if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)) return expression.argumentExpression.text
	return undefined
}

function getFunctionLikeName(node: ts.Node): string | undefined {
	if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) {
		const name = node.name
		if (name !== undefined && ts.isIdentifier(name)) return name.text
	}
	if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
		const parent = node.parent
		if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
		if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text
		if (ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
	}

	return undefined
}

function isManifestSafetyIdLike(type: ts.Type): boolean {
	if ((type.flags & ts.TypeFlags.Any) !== 0) return false
	if ((type.flags & ts.TypeFlags.Unknown) !== 0) return false
	if ((type.flags & ts.TypeFlags.String) !== 0) return false
	if (type.isUnion()) return type.types.every(isManifestSafetyIdLike)
	if (type.isIntersection()) return type.types.every(isManifestSafetyIdLike)
	if (type.isStringLiteral()) return manifestIds.has(type.value)
	return false
}

function createFinding(repositoryRoot: string, sourceFile: ts.SourceFile, node: ts.Node, message: string): ActionSafetyFinding {
	const { column, line } = getLineAndColumn(sourceFile, node)
	return {
		column,
		file: toRelativePath(sourceFile.fileName, repositoryRoot),
		line,
		message,
	}
}

function scanSafetyIdExpression({ attribute, checker, componentName, repositoryRoot, sourceFile }: { attribute: ts.JsxAttribute; checker: ts.TypeChecker; componentName: string; repositoryRoot: string; sourceFile: ts.SourceFile }) {
	const initializer = attribute.initializer
	if (initializer === undefined) return [createFinding(repositoryRoot, sourceFile, attribute, `${componentName} is missing a safetyId attribute`)]

	const expression = (() => {
		if (ts.isStringLiteralLike(initializer)) return initializer
		if (ts.isJsxExpression(initializer) && initializer.expression !== undefined) return initializer.expression
		return undefined
	})()
	if (expression === undefined) return [createFinding(repositoryRoot, sourceFile, attribute, `${componentName} safetyId must be provided as a string or expression`)]

	const unwrappedExpression = unwrapSafetyExpression(expression)
	if (ts.isStringLiteralLike(unwrappedExpression)) {
		if (!manifestIds.has(unwrappedExpression.text)) {
			return [createFinding(repositoryRoot, sourceFile, unwrappedExpression, `${componentName} safetyId '${unwrappedExpression.text}' is not registered in the action safety manifest`)]
		}

		return []
	}

	if (ts.isCallExpression(unwrappedExpression)) {
		const helperSymbol = checker.getSymbolAtLocation(unwrappedExpression.expression)
		if (helperSymbol === undefined) return [createFinding(repositoryRoot, sourceFile, unwrappedExpression, `${componentName} safetyId must use an approved safety helper or a manifest-registered literal`)]

		const resolvedHelperSymbol = getResolvedSymbol(helperSymbol, checker)
		const helperName = resolvedHelperSymbol.getName()
		const helperDeclarationPath = getSymbolDeclarationPath(resolvedHelperSymbol, repositoryRoot)
		if (helperDeclarationPath !== 'ui/ts/lib/actionSafety/ids.ts' || !allowedSafetyIdHelpers.has(helperName)) {
			return [createFinding(repositoryRoot, sourceFile, unwrappedExpression, `${componentName} safetyId must use an approved safety helper or a manifest-registered literal`)]
		}

		const callType = checker.getTypeAtLocation(unwrappedExpression)
		if (!isManifestSafetyIdLike(callType)) {
			return [createFinding(repositoryRoot, sourceFile, unwrappedExpression, `${componentName} safetyId must resolve to a manifest-registered safety id`)]
		}

		return []
	}

	const safetyType = checker.getTypeAtLocation(unwrappedExpression)
	if (!isManifestSafetyIdLike(safetyType)) {
		return [createFinding(repositoryRoot, sourceFile, unwrappedExpression, `${componentName} safetyId must resolve to a manifest-registered safety id`)]
	}

	return []
}

function scanActionSafetySourceFile(sourceFile: ts.SourceFile, checker: ts.TypeChecker, repositoryRoot: string): ActionSafetyFinding[] {
	const findings: ActionSafetyFinding[] = []
	const relativePath = toRelativePath(sourceFile.fileName, repositoryRoot)
	const isActionSafetyLibrary = relativePath.startsWith('ui/ts/lib/actionSafety/')

	const visit = (node: ts.Node, isPurityScope = isActionSafetyLibrary): void => {
		const functionName = getFunctionLikeName(node)
		const nextPurityScope = isPurityScope || (functionName !== undefined && safetyFunctionNamePattern.test(functionName))

		if (nextPurityScope && ts.isCallExpression(node)) {
			const calleeName = getExpressionName(node.expression)
			if (calleeName !== undefined && bannedActionSafetyCallPrefixes.some(prefix => calleeName.startsWith(prefix))) {
				findings.push(createFinding(repositoryRoot, sourceFile, node, `Action safety helpers must stay pure and synchronous; '${calleeName}' is not allowed here`))
			}
		}

		if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
			const safetyAttribute = getJsxAttribute(node, 'safetyId')
			if (safetyAttribute !== undefined) {
				const jsxSymbol = checker.getSymbolAtLocation(node.tagName)
				if (jsxSymbol !== undefined) {
					const resolvedJsxSymbol = getResolvedSymbol(jsxSymbol, checker)
					const componentDeclarationPath = getSymbolDeclarationPath(resolvedJsxSymbol, repositoryRoot)
					if (componentDeclarationPath !== undefined && isProductionUiSourcePath(componentDeclarationPath)) {
						const componentName = resolvedJsxSymbol.getName()
						findings.push(...scanSafetyIdExpression({ attribute: safetyAttribute, checker, componentName, repositoryRoot, sourceFile }))
					}
				}
			}
		}

		ts.forEachChild(node, child => visit(child, nextPurityScope))
	}

	visit(sourceFile)
	return findings
}

export function scanActionSafetySources(options: ScanActionSafetySourcesOptions = {}) {
	const repositoryRoot = path.resolve(options.repositoryRoot ?? defaultRepositoryRoot)
	const configPath = path.resolve(options.configPath ?? defaultUiTsConfigPath)
	const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
	if (configFile.error !== undefined) throw new Error(ts.formatDiagnostic(configFile.error, formatDiagnosticHost))

	const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath))
	const program = ts.createProgram({ options: parsedConfig.options, rootNames: parsedConfig.fileNames })
	const checker = program.getTypeChecker()
	const findings: ActionSafetyFinding[] = []

	for (const sourceFile of program.getSourceFiles()) {
		if (sourceFile.isDeclarationFile) continue
		const relativePath = toRelativePath(sourceFile.fileName, repositoryRoot)
		if (!isProductionUiSourcePath(relativePath)) continue
		findings.push(...scanActionSafetySourceFile(sourceFile, checker, repositoryRoot))
	}

	return findings
}

const formatDiagnosticHost: ts.FormatDiagnosticsHost = {
	getCanonicalFileName: (fileName: string) => fileName,
	getCurrentDirectory: () => defaultRepositoryRoot,
	getNewLine: () => '\n',
}
