import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import * as ts from 'typescript'

const projectRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const uiSourceRoots = [path.join(projectRoot, 'ui', 'coreShared', 'ts'), path.join(projectRoot, 'ui', 'zoltar', 'ts'), path.join(projectRoot, 'ui', 'statoblast', 'ts'), path.join(projectRoot, 'ui', 'trading', 'ts')]

export type UiLayerBoundaryFinding = {
	column: number
	file: string
	line: number
	rule: 'features-must-not-import-app' | 'shared-layers-must-not-import-app' | 'shared-layers-must-not-import-features' | 'test-layers-must-follow-ownership' | 'cross-package-import-boundary'
	specifier: string
}

function isWithin(candidatePath: string, directoryPath: string) {
	return candidatePath === directoryPath || candidatePath.startsWith(`${directoryPath}/`)
}

const appPackagePattern = /^ui\/(coreShared|zoltar|statoblast|trading)\/ts(?:\/|$)/
const packageAliases: Record<string, string> = { '@zoltar/ui-core-shared': 'coreShared', '@zoltar/ui-zoltar': 'zoltar', '@zoltar/ui-statoblast': 'statoblast', '@zoltar/ui-trading': 'trading' }
const allowedCrossPackageImports: Record<string, readonly string[]> = { coreShared: [], zoltar: ['coreShared'], statoblast: ['coreShared', 'zoltar'], trading: ['coreShared', 'zoltar', 'statoblast'] }

function getViolatedRule(sourcePath: string, specifier: string): UiLayerBoundaryFinding['rule'] | undefined {
	const sourcePackageMatch = appPackagePattern.exec(sourcePath)
	if (sourcePackageMatch === null) return undefined
	const sourcePackage = sourcePackageMatch[1]
	if (sourcePackage === undefined) return undefined
	const aliasMatch = /^(@zoltar\/ui-[a-z-]+)(?:\/|$)/.exec(specifier)
	if (aliasMatch !== null) {
		const aliasName = aliasMatch[1]
		const targetPackage = aliasName === undefined ? undefined : packageAliases[aliasName]
		if (targetPackage === undefined) return undefined
		const allowedTargets = allowedCrossPackageImports[sourcePackage] ?? []
		if (targetPackage === sourcePackage || !allowedTargets.includes(targetPackage)) return 'cross-package-import-boundary'
		return undefined
	}
	if (!specifier.startsWith('.')) return undefined
	const resolvedPath = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier))
	const resolvedPackageMatch = appPackagePattern.exec(resolvedPath)
	if (resolvedPackageMatch !== null) {
		const targetPackage = resolvedPackageMatch[1]
		if (targetPackage !== undefined && targetPackage !== sourcePackage) return 'cross-package-import-boundary'
	}
	const packageRoot = `ui/${sourcePackage}/ts`
	const sharedLayerRoots = [`${packageRoot}/components`, `${packageRoot}/hooks`, `${packageRoot}/lib`, `${packageRoot}/protocol`, `${packageRoot}/simulation`, `${packageRoot}/types`]
	const sourceIsSharedLayer = sharedLayerRoots.some(directoryPath => isWithin(sourcePath, directoryPath))
	if (sourceIsSharedLayer && isWithin(resolvedPath, `${packageRoot}/features`)) return 'shared-layers-must-not-import-features'
	if (sourceIsSharedLayer && isWithin(resolvedPath, `${packageRoot}/app`)) return 'shared-layers-must-not-import-app'
	if (isWithin(sourcePath, `${packageRoot}/features`) && isWithin(resolvedPath, `${packageRoot}/app`)) return 'features-must-not-import-app'
	const targetIsApp = isWithin(resolvedPath, `${packageRoot}/app`)
	const targetIsFeature = isWithin(resolvedPath, `${packageRoot}/features`)
	const targetIsProtocol = isWithin(resolvedPath, `${packageRoot}/protocol`)
	const targetIsSimulation = isWithin(resolvedPath, `${packageRoot}/simulation`)
	const sourceIsRootTest = path.posix.dirname(sourcePath) === `${packageRoot}/tests`
	if (sourceIsRootTest && (targetIsApp || targetIsFeature || targetIsProtocol || targetIsSimulation)) return 'test-layers-must-follow-ownership'
	if (isWithin(sourcePath, `${packageRoot}/tests/testUtils`) && (targetIsApp || targetIsFeature || targetIsProtocol || targetIsSimulation)) return 'test-layers-must-follow-ownership'
	if (isWithin(sourcePath, `${packageRoot}/tests/features`) && targetIsApp) return 'test-layers-must-follow-ownership'
	if (isWithin(sourcePath, `${packageRoot}/tests/protocol`) && (targetIsApp || targetIsFeature || targetIsSimulation)) return 'test-layers-must-follow-ownership'
	if (isWithin(sourcePath, `${packageRoot}/tests/simulation`) && (targetIsApp || targetIsFeature)) return 'test-layers-must-follow-ownership'
	return undefined
}

export function findUiLayerBoundaryViolations(sourcePath: string, sourceText: string): UiLayerBoundaryFinding[] {
	const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, sourcePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
	const findings: UiLayerBoundaryFinding[] = []

	const recordSpecifier = (specifier: ts.StringLiteralLike) => {
		const rule = getViolatedRule(sourcePath, specifier.text)
		if (rule === undefined) return
		const position = sourceFile.getLineAndCharacterOfPosition(specifier.getStart(sourceFile))
		findings.push({
			column: position.character + 1,
			file: sourcePath,
			line: position.line + 1,
			rule,
			specifier: specifier.text,
		})
	}

	const visit = (node: ts.Node): void => {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) recordSpecifier(node.moduleSpecifier)
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const [specifier] = node.arguments
			if (specifier !== undefined && ts.isStringLiteralLike(specifier)) recordSpecifier(specifier)
		}
		if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) recordSpecifier(node.argument.literal)
		ts.forEachChild(node, visit)
	}

	visit(sourceFile)
	return findings
}

async function collectSourceFiles(directory: string, files: string[] = []): Promise<string[]> {
	for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
		const filePath = path.join(directory, entry.name)
		if (entry.isDirectory()) {
			await collectSourceFiles(filePath, files)
			continue
		}
		if (entry.isFile() && /\.(?:cts|mts|ts|tsx)$/u.test(entry.name)) files.push(filePath)
	}
	return files
}

async function main() {
	const findings: UiLayerBoundaryFinding[] = []
	for (const uiSourceRoot of uiSourceRoots) {
		for (const filePath of await collectSourceFiles(uiSourceRoot)) {
			const sourcePath = path.relative(projectRoot, filePath).replaceAll('\\', '/')
			findings.push(...findUiLayerBoundaryViolations(sourcePath, await fs.readFile(filePath, 'utf8')))
		}
	}

	if (findings.length === 0) return

	console.error('UI dependencies must point inward: app may compose features, while shared layers must never depend on app or feature ownership.')
	for (const finding of findings) console.error(`${finding.file}:${finding.line}:${finding.column} - ${finding.rule}: ${finding.specifier}`)
	process.exitCode = 1
}

if (import.meta.main) await main()
