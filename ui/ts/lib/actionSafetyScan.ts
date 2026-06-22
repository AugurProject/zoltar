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

const repositoryRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../../../')
const uiTsConfigPath = path.join(repositoryRoot, 'ui', 'tsconfig.json')
const manifestIds = new Set<string>(ACTION_SAFETY_MANIFEST.map(entry => entry.id))
const allowedSafetyIdHelpers = new Set(['getDeploymentStepSafetyId', 'getForkAuctionActionSafetyId', 'getOpenOracleActionSafetyId', 'getReportingActionSafetyId', 'getSecurityPoolOverviewActionSafetyId', 'getSecurityVaultActionSafetyId', 'getTradingActionSafetyId'])
const safetyComponentNames = new Set(['ActionLauncherButton', 'ChildUniverseDeploymentModal', 'TokenApprovalControl', 'TransactionActionButton'])
const bannedActionSafetyCallPrefixes = ['load', 'quote', 'read', 'send', 'simulate', 'write']
const generatedUiFiles = new Set(['ui/ts/abis.ts', 'ui/ts/contractArtifact.ts', 'ui/ts/deploymentArtifacts.ts', 'ui/ts/deploymentsArtifacts.ts'])

function toRelativePath(filePath: string) {
	return path.relative(repositoryRoot, filePath).replaceAll('\\', '/')
}

function getLineAndColumn(sourceFile: ts.SourceFile, node: ts.Node) {
	const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
	return {
		column: position.character + 1,
		line: position.line + 1,
	}
}

function getJsxTagName(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement) {
	if (ts.isIdentifier(node.tagName)) return node.tagName.text
	return undefined
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

function isLiteralStringUnionLike(type: ts.Type): boolean {
	if ((type.flags & ts.TypeFlags.Any) !== 0) return false
	if ((type.flags & ts.TypeFlags.Unknown) !== 0) return false
	if ((type.flags & ts.TypeFlags.String) !== 0) return false
	if (type.isUnion()) return type.types.every(isLiteralStringUnionLike)
	if (type.isIntersection()) return type.types.every(isLiteralStringUnionLike)
	if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) return true
	if ((type.flags & ts.TypeFlags.TemplateLiteral) !== 0) return true
	return false
}

function createFinding(sourceFile: ts.SourceFile, node: ts.Node, message: string): ActionSafetyFinding {
	const { column, line } = getLineAndColumn(sourceFile, node)
	return {
		column,
		file: toRelativePath(sourceFile.fileName),
		line,
		message,
	}
}

function scanSafetyIdExpression({ attribute, checker, componentName, sourceFile }: { attribute: ts.JsxAttribute; checker: ts.TypeChecker; componentName: string; sourceFile: ts.SourceFile }) {
	const initializer = attribute.initializer
	if (initializer === undefined) return [createFinding(sourceFile, attribute, `${componentName} is missing a safetyId attribute`)]

	const expression = (() => {
		if (ts.isStringLiteralLike(initializer)) return initializer
		if (ts.isJsxExpression(initializer) && initializer.expression !== undefined) return initializer.expression
		return undefined
	})()
	if (expression === undefined) return [createFinding(sourceFile, attribute, `${componentName} safetyId must be provided as a string or expression`)]

	const unwrappedExpression = unwrapSafetyExpression(expression)
	if (ts.isStringLiteralLike(unwrappedExpression)) {
		if (!manifestIds.has(unwrappedExpression.text)) return [createFinding(sourceFile, unwrappedExpression, `${componentName} safetyId '${unwrappedExpression.text}' is not registered in the action safety manifest`)]
		return []
	}

	if (ts.isCallExpression(unwrappedExpression)) {
		const helperName = getExpressionName(unwrappedExpression.expression)
		if (helperName === undefined || !allowedSafetyIdHelpers.has(helperName)) return [createFinding(sourceFile, unwrappedExpression, `${componentName} safetyId must use an approved safety helper or a manifest-registered literal`)]
		return []
	}

	const safetyType = checker.getTypeAtLocation(unwrappedExpression)
	if (!isLiteralStringUnionLike(safetyType)) return [createFinding(sourceFile, unwrappedExpression, `${componentName} safetyId must resolve to a literal safety id`)]

	return []
}

function scanActionSafetySourceFile(sourceFile: ts.SourceFile, checker: ts.TypeChecker): ActionSafetyFinding[] {
	const findings: ActionSafetyFinding[] = []
	const relativePath = toRelativePath(sourceFile.fileName)
	const isActionSafetyLibrary = relativePath.startsWith('ui/ts/lib/actionSafety/')

	const visit = (node: ts.Node): void => {
		if (isActionSafetyLibrary && ts.isCallExpression(node)) {
			const calleeName = getExpressionName(node.expression)
			if (calleeName !== undefined && bannedActionSafetyCallPrefixes.some(prefix => calleeName.startsWith(prefix))) {
				findings.push(createFinding(sourceFile, node, `Action safety helpers must stay pure and synchronous; '${calleeName}' is not allowed here`))
			}
		}

		if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
			const componentName = getJsxTagName(node)
			if (componentName !== undefined && safetyComponentNames.has(componentName)) {
				const safetyAttribute = getJsxAttribute(node, 'safetyId')
				if (safetyAttribute === undefined) {
					findings.push(createFinding(sourceFile, node, `${componentName} is missing a safetyId`))
				} else {
					findings.push(...scanSafetyIdExpression({ attribute: safetyAttribute, checker, componentName, sourceFile }))
				}
			}
		}

		ts.forEachChild(node, visit)
	}

	visit(sourceFile)
	return findings
}

export function scanActionSafetySources() {
	const configFile = ts.readConfigFile(uiTsConfigPath, ts.sys.readFile)
	if (configFile.error !== undefined) throw new Error(ts.formatDiagnostic(configFile.error, formatDiagnosticHost))
	const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(uiTsConfigPath))
	const program = ts.createProgram({ options: parsedConfig.options, rootNames: parsedConfig.fileNames })
	const checker = program.getTypeChecker()
	const findings: ActionSafetyFinding[] = []

	for (const sourceFile of program.getSourceFiles()) {
		if (sourceFile.isDeclarationFile) continue
		const relativePath = toRelativePath(sourceFile.fileName)
		if (!relativePath.startsWith('ui/ts/')) continue
		if (relativePath.startsWith('ui/ts/tests/')) continue
		if (relativePath.startsWith('ui/js/')) continue
		if (generatedUiFiles.has(relativePath)) continue
		findings.push(...scanActionSafetySourceFile(sourceFile, checker))
	}

	return findings
}

const formatDiagnosticHost: ts.FormatDiagnosticsHost = {
	getCanonicalFileName: (fileName: string) => fileName,
	getCurrentDirectory: () => repositoryRoot,
	getNewLine: () => '\n',
}
