import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import * as ts from 'typescript'

const projectRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const uiSourceRoot = path.join(projectRoot, 'ui', 'ts')

export type UiLayerBoundaryFinding = {
	column: number
	file: string
	line: number
	rule: 'features-must-not-import-app' | 'shared-layers-must-not-import-app' | 'shared-layers-must-not-import-features' | 'test-layers-must-follow-ownership'
	specifier: string
}

function isWithin(candidatePath: string, directoryPath: string) {
	return candidatePath === directoryPath || candidatePath.startsWith(`${directoryPath}/`)
}

function getViolatedRule(sourcePath: string, specifier: string): UiLayerBoundaryFinding['rule'] | undefined {
	if (!specifier.startsWith('.')) return undefined
	const resolvedPath = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier))
	const sharedLayerRoots = ['ui/ts/components', 'ui/ts/hooks', 'ui/ts/lib', 'ui/ts/protocol', 'ui/ts/simulation', 'ui/ts/types']
	const sourceIsSharedLayer = sharedLayerRoots.some(directoryPath => isWithin(sourcePath, directoryPath))
	if (sourceIsSharedLayer && isWithin(resolvedPath, 'ui/ts/features')) return 'shared-layers-must-not-import-features'
	if (sourceIsSharedLayer && isWithin(resolvedPath, 'ui/ts/app')) return 'shared-layers-must-not-import-app'
	if (isWithin(sourcePath, 'ui/ts/features') && isWithin(resolvedPath, 'ui/ts/app')) return 'features-must-not-import-app'
	const targetIsApp = isWithin(resolvedPath, 'ui/ts/app')
	const targetIsFeature = isWithin(resolvedPath, 'ui/ts/features')
	const targetIsProtocol = isWithin(resolvedPath, 'ui/ts/protocol')
	const targetIsSimulation = isWithin(resolvedPath, 'ui/ts/simulation')
	const sourceIsRootTest = path.posix.dirname(sourcePath) === 'ui/ts/tests'
	if (sourceIsRootTest && (targetIsApp || targetIsFeature || targetIsProtocol || targetIsSimulation)) return 'test-layers-must-follow-ownership'
	if (isWithin(sourcePath, 'ui/ts/tests/testUtils') && (targetIsApp || targetIsFeature || targetIsProtocol || targetIsSimulation)) return 'test-layers-must-follow-ownership'
	if (isWithin(sourcePath, 'ui/ts/tests/features') && targetIsApp) return 'test-layers-must-follow-ownership'
	if (isWithin(sourcePath, 'ui/ts/tests/protocol') && (targetIsApp || targetIsFeature || targetIsSimulation)) return 'test-layers-must-follow-ownership'
	if (isWithin(sourcePath, 'ui/ts/tests/simulation') && (targetIsApp || targetIsFeature)) return 'test-layers-must-follow-ownership'
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
	for (const filePath of await collectSourceFiles(uiSourceRoot)) {
		const sourcePath = path.relative(projectRoot, filePath).replaceAll('\\', '/')
		findings.push(...findUiLayerBoundaryViolations(sourcePath, await fs.readFile(filePath, 'utf8')))
	}

	if (findings.length === 0) return

	console.error('UI dependencies must point inward: app may compose features, while shared layers must never depend on app or feature ownership.')
	for (const finding of findings) console.error(`${finding.file}:${finding.line}:${finding.column} - ${finding.rule}: ${finding.specifier}`)
	process.exitCode = 1
}

if (import.meta.main) await main()
