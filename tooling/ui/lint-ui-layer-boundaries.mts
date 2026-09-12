import { promises as fs, readFileSync } from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import * as ts from 'typescript'

const projectRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..')
const uiPackageIds = ['coreShared', 'zoltarShared', 'statoblastShared', 'zoltar', 'statoblast', 'trading'] as const
const uiSourceRoots = uiPackageIds.map(packageId => path.join(projectRoot, 'ui', packageId, 'ts'))

export type UiLayerBoundaryFinding = {
	column: number
	file: string
	line: number
	rule: 'features-must-not-import-app' | 'shared-layers-must-not-import-app' | 'shared-layers-must-not-import-features' | 'test-layers-must-follow-ownership' | 'cross-package-import-boundary' | 'cross-package-private-subpath'
	specifier: string
}

function isWithin(candidatePath: string, directoryPath: string) {
	return candidatePath === directoryPath || candidatePath.startsWith(`${directoryPath}/`)
}

const appPackagePattern = /^ui\/(coreShared|zoltarShared|statoblastShared|zoltar|statoblast|trading)\/ts(?:\/|$)/
const packageAliases: Record<string, string> = {
	'@zoltar/ui-core-shared': 'coreShared',
	'@zoltar/ui-zoltar-shared': 'zoltarShared',
	'@zoltar/ui-statoblast-shared': 'statoblastShared',
	'@zoltar/ui-zoltar': 'zoltar',
	'@zoltar/ui-statoblast': 'statoblast',
	'@zoltar/ui-trading': 'trading',
}
const sharedLibraryPackageIds = new Set(['zoltarShared', 'statoblastShared'])
const sharedLibraryPublicExports = new Map(
	Object.entries(packageAliases)
		.filter(([, packageId]) => sharedLibraryPackageIds.has(packageId))
		.map(([alias, packageId]) => {
			const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'ui', packageId, 'package.json'), 'utf8')) as { exports?: Record<string, unknown> }
			return [alias, new Set(Object.keys(manifest.exports ?? {}))] as const
		}),
)
const allowedCrossPackageImports: Record<string, readonly string[]> = {
	coreShared: [],
	zoltarShared: ['coreShared'],
	statoblastShared: ['coreShared', 'zoltarShared'],
	zoltar: ['coreShared', 'zoltarShared'],
	statoblast: ['coreShared', 'zoltarShared', 'statoblastShared'],
	trading: ['coreShared', 'zoltarShared', 'statoblastShared'],
}

function getViolatedRule(sourcePath: string, specifier: string): UiLayerBoundaryFinding['rule'] | undefined {
	const sourcePackageMatch = appPackagePattern.exec(sourcePath)
	if (sourcePackageMatch === null) return undefined
	const sourcePackage = sourcePackageMatch[1]
	if (sourcePackage === undefined) return undefined
	const aliasMatch = /^(@zoltar\/ui-[a-z-]+)(?:\/|$)/.exec(specifier)
	if (aliasMatch !== null) {
		const aliasName = aliasMatch[1]
		if (aliasName === undefined) return undefined
		const targetPackage = packageAliases[aliasName]
		if (targetPackage === undefined) return undefined
		const allowedTargets = allowedCrossPackageImports[sourcePackage] ?? []
		if (targetPackage === sourcePackage || !allowedTargets.includes(targetPackage)) return 'cross-package-import-boundary'
		const publicExports = sharedLibraryPublicExports.get(aliasName)
		if (publicExports !== undefined) {
			const subpath = specifier === aliasName ? '.' : `.${specifier.slice(aliasName.length)}`
			if (!publicExports.has(subpath)) return 'cross-package-private-subpath'
		}
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

export type UiExportsManifestFinding = {
	detail: string
	packageId: string
}

// Bun serves the default (built js) export target whenever it exists and only
// falls back to the bun-condition source when it is missing, so every entry
// must name an existing source file and every .tsx module needs an explicit
// entry: the './*' wildcard's bun condition can only map to './ts/*.ts'.
export function findUiExportsManifestViolations(packageId: string, manifestExports: Readonly<Record<string, unknown>>, sourceFiles: readonly string[]): UiExportsManifestFinding[] {
	const findings: UiExportsManifestFinding[] = []
	const sourceFileSet = new Set(sourceFiles)
	const sourceTargetOf = (value: unknown): string | undefined => {
		if (typeof value === 'string') return value
		if (typeof value === 'object' && value !== null && 'bun' in value && typeof (value as { bun: unknown }).bun === 'string') return (value as { bun: string }).bun
		return undefined
	}
	for (const [key, value] of Object.entries(manifestExports)) {
		if (key.includes('*')) continue
		const sourceTarget = sourceTargetOf(value)
		if (sourceTarget === undefined) {
			findings.push({ detail: `exports entry ${key} has no bun-condition source target`, packageId })
			continue
		}
		if (!sourceFileSet.has(sourceTarget.replace(/^\.\//, ''))) findings.push({ detail: `exports entry ${key} points its bun condition at missing ${sourceTarget}`, packageId })
	}
	if ('./*' in manifestExports) {
		for (const sourceFile of sourceFiles) {
			if (!sourceFile.endsWith('.tsx')) continue
			const entryKey = `./${sourceFile.slice('ts/'.length, -'.tsx'.length)}.js`
			if (!(entryKey in manifestExports)) findings.push({ detail: `.tsx module ${sourceFile} needs an explicit exports entry so bun resolves it to sources when built output is absent`, packageId })
		}
	}
	return findings
}

async function main() {
	const findings: UiLayerBoundaryFinding[] = []
	for (const uiSourceRoot of uiSourceRoots) {
		for (const filePath of await collectSourceFiles(uiSourceRoot)) {
			const sourcePath = path.relative(projectRoot, filePath).replaceAll('\\', '/')
			findings.push(...findUiLayerBoundaryViolations(sourcePath, await fs.readFile(filePath, 'utf8')))
		}
	}

	const manifestFindings: UiExportsManifestFinding[] = []
	for (const packageId of ['coreShared', 'zoltarShared', 'statoblastShared']) {
		const packageRoot = path.join(projectRoot, 'ui', packageId)
		const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8')) as { exports?: Record<string, unknown> }
		const sourceFiles = (await collectSourceFiles(path.join(packageRoot, 'ts'))).map(filePath => path.relative(packageRoot, filePath).replaceAll('\\', '/'))
		manifestFindings.push(...findUiExportsManifestViolations(packageId, manifest.exports ?? {}, sourceFiles))
	}

	if (findings.length === 0 && manifestFindings.length === 0) return

	if (findings.length > 0) console.error('UI dependencies must point inward: app may compose features, while shared layers must never depend on app or feature ownership.')
	for (const finding of findings) console.error(`${finding.file}:${finding.line}:${finding.column} - ${finding.rule}: ${finding.specifier}`)
	for (const finding of manifestFindings) console.error(`ui/${finding.packageId}/package.json - ${finding.detail}`)
	process.exitCode = 1
}

if (import.meta.main) await main()
