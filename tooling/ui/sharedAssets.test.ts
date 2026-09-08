import { expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as ts from 'typescript'
import { sharedBrowserArtifactRelativePaths } from './sharedBrowserArtifacts.ts'
import { assertSuccessfulBuilds, clearVendorOutput, vendor } from './vendor.mts'
import { UI_APP_IDS, getUiAppPaths, getUiCoreSharedPaths, getUiPackageRoot } from './appPaths.mts'
import { copyProjectArtifacts, isCoreProjectContractPath, type ProjectArtifactPaths } from './projectArtifacts.mts'

const coreSharedPaths = getUiCoreSharedPaths()
const repositoryRootPath = coreSharedPaths.repositoryRoot
const uiRootPath = coreSharedPaths.uiRoot
const zoltarDomainSourceRoot = path.join(getUiPackageRoot(uiRootPath, 'zoltarDomain'), 'ts')
const statoblastDomainSourceRoot = path.join(getUiPackageRoot(uiRootPath, 'statoblastDomain'), 'ts')
const uiProtocolPaths = [path.join(zoltarDomainSourceRoot, 'protocol', 'forks.ts'), path.join(zoltarDomainSourceRoot, 'protocol', 'openOracle.ts'), path.join(statoblastDomainSourceRoot, 'protocol', 'trading.ts')]
const uiDeploymentHelpersPath = path.join(zoltarDomainSourceRoot, 'protocol', 'deploymentHelpers.ts')
const uiReportingDomainPath = path.join(zoltarDomainSourceRoot, 'features', 'reporting', 'lib', 'reportingDomain.ts')
const uiSepoliaDeploymentConfigPath = path.join(coreSharedPaths.coreSharedSourceRoot, 'lib', 'sepoliaDeploymentConfig.ts')
const uiSimulationBootstrapPath = path.join(coreSharedPaths.coreSharedSourceRoot, 'simulation', 'bootstrap.ts')
const uiTruthAuctionBookPath = path.join(statoblastDomainSourceRoot, 'features', 'truth-auctions', 'lib', 'truthAuctionBook.ts')
const uiIndexHtmlPaths = new Map(UI_APP_IDS.map(appId => [appId, path.join(uiRootPath, appId, 'index.html')]))
const uiVendorBuildPath = path.join(import.meta.dir, 'vendor.mts')
const uiWatchBuildPath = path.join(import.meta.dir, 'watch.mts')
const uiWorkerBuildPath = path.join(import.meta.dir, 'workers.mts')
const rootPackageJsonPath = path.join(repositoryRootPath, 'package.json')
const sharedPackageJsonPath = path.join(repositoryRootPath, 'shared', 'package.json')
const sharedBrowserArtifacts = sharedBrowserArtifactRelativePaths.map(relativePath => path.join(repositoryRootPath, relativePath))
const developmentImportMapRegressionEntries: Record<string, string> = {
	'@zoltar/shared/evm/ethereum': '../shared/js/evm/ethereum.js',
	'@zoltar/shared/evm/logScan': '../shared/js/evm/logScan.js',
	'@zoltar/shared/statoblast/scalarOutcome': '../shared/js/statoblast/scalarOutcome.js',
	'@zoltar/shared/deployment/sepoliaRepAllocations': '../shared/js/deployment/sepoliaRepAllocations.js',
	'@zoltar/shared/serialization/sortStringArrayByKeccak': '../shared/js/serialization/sortStringArrayByKeccak.js',
	abitype: './vendor/abitype/exports/index.js',
	'micro-eth-signer': './vendor/micro-eth-signer/index.js',
	'micro-eth-signer/advanced/abi.js': './vendor/micro-eth-signer/advanced/abi.js',
	'micro-packed': './vendor/micro-packed/index.js',
	'@scure/base': './vendor/@scure/base/index.js',
	'@noble/hashes/sha2': './vendor/@noble/hashes/sha2.js',
	'@noble/hashes/sha3': './vendor/@noble/hashes/sha3.js',
	'@noble/curves/secp256k1': './vendor/@noble/curves/secp256k1.js',
	'@noble/curves/utils.js': './vendor/@noble/curves/utils.js',
	isows: './vendor/isows/native.js',
	'ox/Ens': './vendor/ox/core/Ens.js',
	'ox/erc6492': './vendor/ox/erc6492/index.js',
	'ox/erc8010': './vendor/ox/erc8010/index.js',
}

type ImportMapFile = {
	imports?: Record<string, string>
}

type NamedModuleReference = {
	names: string[]
	specifier: string
}

type ResolvedImport = {
	filePath: string
	kind: 'file' | 'vendor'
}

function readDevelopmentImportMap(appId: (typeof UI_APP_IDS)[number]): Record<string, string> {
	const uiIndexHtmlPath = uiIndexHtmlPaths.get(appId)
	if (uiIndexHtmlPath === undefined) throw new Error(`No index.html path recorded for ${appId}.`)
	const uiIndexHtml = fs.readFileSync(uiIndexHtmlPath, 'utf8')
	const importMapMatch = uiIndexHtml.match(/<script\s+type=['"]importmap['"][^>]*>([\s\S]*?)<\/script>/)
	if (importMapMatch === null || importMapMatch[1] === undefined) {
		throw new Error(`Expected ${uiIndexHtmlPath} to contain a development import map script.`)
	}
	const importMap = JSON.parse(importMapMatch[1]) as ImportMapFile
	if (importMap.imports === undefined) {
		throw new Error(`Expected the development import map in ${uiIndexHtmlPath} to include imports.`)
	}
	return importMap.imports
}

function isBareModuleSpecifier(specifier: string) {
	return !specifier.startsWith('.') && !specifier.startsWith('/') && !/^[a-zA-Z][a-zA-Z+.-]*:/.test(specifier)
}

function resolveImportMapSpecifier(specifier: string, imports: Record<string, string>) {
	const exactMatch = imports[specifier]
	if (exactMatch !== undefined) return exactMatch

	let matchedPrefix: string | undefined
	let matchedPath: string | undefined
	for (const [prefix, mappedPath] of Object.entries(imports)) {
		if (!prefix.endsWith('/') || !specifier.startsWith(prefix)) continue
		if (matchedPrefix !== undefined && prefix.length <= matchedPrefix.length) continue
		matchedPrefix = prefix
		matchedPath = mappedPath
	}
	if (matchedPrefix === undefined || matchedPath === undefined) return undefined

	return `${matchedPath}${specifier.slice(matchedPrefix.length)}`
}

function resolveDevelopmentImport(fromPath: string, specifier: string, imports: Record<string, string>, appRootPath: string) {
	if (!isBareModuleSpecifier(specifier)) {
		const resolvedSourcePath = resolveSourceModulePath(fromPath, specifier)
		if (resolvedSourcePath !== undefined) {
			return {
				filePath: resolvedSourcePath,
				kind: 'file',
			} satisfies ResolvedImport
		}

		return {
			filePath: path.resolve(path.dirname(fromPath), specifier),
			kind: 'file',
		} satisfies ResolvedImport
	}

	const mappedSpecifier = resolveImportMapSpecifier(specifier, imports)
	if (mappedSpecifier === undefined) {
		const vendorFallback = resolveSourceModulePath(fromPath, path.join('vendor', specifier))
		if (vendorFallback !== undefined) return { filePath: vendorFallback, kind: 'vendor' } satisfies ResolvedImport
		return undefined
	}
	let rawResolvedPath = path.resolve(appRootPath, mappedSpecifier)
	if (mappedSpecifier.startsWith('/')) rawResolvedPath = path.join(repositoryRootPath, mappedSpecifier)
	else if (mappedSpecifier.startsWith('../shared/')) rawResolvedPath = path.join(repositoryRootPath, mappedSpecifier.replace(/^\.\.\//, ''))
	if (rawResolvedPath.includes(`${path.sep}shared${path.sep}js${path.sep}`)) {
		return {
			filePath: rawResolvedPath,
			kind: 'file',
		} satisfies ResolvedImport
	}
	const sourceResolvedPath = resolveSourceModulePath(fromPath, rawResolvedPath)
	if (sourceResolvedPath !== undefined && !sourceResolvedPath.endsWith('.js') && !sourceResolvedPath.endsWith('.mjs')) {
		return {
			filePath: sourceResolvedPath,
			kind: 'file',
		} satisfies ResolvedImport
	}
	return {
		filePath: rawResolvedPath,
		kind: mappedSpecifier.startsWith('./vendor/') ? 'vendor' : 'file',
	} satisfies ResolvedImport
}

function resolveSourceModulePath(fromPath: string, specifier: string) {
	const rawResolvedPath = path.resolve(path.dirname(fromPath), specifier)
	if (rawResolvedPath.endsWith('.js')) {
		const withoutJavaScriptExtension = rawResolvedPath.slice(0, -'.js'.length)
		const siblingSourceCandidates = [`${withoutJavaScriptExtension}.ts`, `${withoutJavaScriptExtension}.tsx`, `${withoutJavaScriptExtension}.mts`]
		const siblingSource = siblingSourceCandidates.find(candidatePath => fs.existsSync(candidatePath))
		if (siblingSource !== undefined) return siblingSource
	}
	const candidatePaths = [rawResolvedPath]
	candidatePaths.push(`${rawResolvedPath}.js`, `${rawResolvedPath}.mjs`, path.join(rawResolvedPath, 'index.ts'), path.join(rawResolvedPath, 'index.tsx'), path.join(rawResolvedPath, 'index.js'))

	return candidatePaths.find(candidatePath => fs.existsSync(candidatePath))
}

function getScriptKind(filePath: string) {
	if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX
	if (filePath.endsWith('.ts') || filePath.endsWith('.mts')) return ts.ScriptKind.TS
	return ts.ScriptKind.JS
}

function parseModule(filePath: string, source: string) {
	return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, getScriptKind(filePath))
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind) {
	if (!ts.canHaveModifiers(node)) return false
	return ts.getModifiers(node)?.some(modifier => modifier.kind === kind) === true
}

function getModuleSpecifierText(node: ts.ImportDeclaration | ts.ExportDeclaration) {
	const moduleSpecifier = node.moduleSpecifier
	if (moduleSpecifier === undefined || !ts.isStringLiteral(moduleSpecifier)) return undefined
	return moduleSpecifier.text
}

function isRuntimeImportDeclaration(node: ts.ImportDeclaration) {
	const importClause = node.importClause
	if (importClause === undefined) return true
	if (importClause.isTypeOnly) return false
	const namedBindings = importClause.namedBindings
	if (namedBindings === undefined || !ts.isNamedImports(namedBindings)) return true
	return importClause.name !== undefined || namedBindings.elements.some(element => !element.isTypeOnly)
}

function isRuntimeExportDeclaration(node: ts.ExportDeclaration) {
	if (node.isTypeOnly) return false
	const exportClause = node.exportClause
	if (exportClause === undefined || !ts.isNamedExports(exportClause)) return true
	return exportClause.elements.some(element => !element.isTypeOnly)
}

function collectBindingNames(name: ts.BindingName): string[] {
	if (ts.isIdentifier(name)) return [name.text]
	if (ts.isObjectBindingPattern(name)) return name.elements.flatMap(element => collectBindingNames(element.name))
	return name.elements.flatMap(element => {
		if (ts.isOmittedExpression(element)) return []
		return collectBindingNames(element.name)
	})
}

function collectNamedModuleReferences(sourceFile: ts.SourceFile): NamedModuleReference[] {
	const references: NamedModuleReference[] = []
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			if (!isRuntimeImportDeclaration(statement)) continue
			const specifier = getModuleSpecifierText(statement)
			if (specifier === undefined) continue
			const importClause = statement.importClause
			if (importClause === undefined) continue
			const names: string[] = []
			if (importClause.name !== undefined) names.push('default')
			if (importClause.namedBindings !== undefined && ts.isNamedImports(importClause.namedBindings)) {
				names.push(...importClause.namedBindings.elements.flatMap(element => (element.isTypeOnly ? [] : [(element.propertyName ?? element.name).text])))
			}
			if (names.length > 0) references.push({ names, specifier })
			continue
		}

		if (!ts.isExportDeclaration(statement)) continue
		if (!isRuntimeExportDeclaration(statement)) continue
		const specifier = getModuleSpecifierText(statement)
		if (specifier === undefined) continue
		const exportClause = statement.exportClause
		if (exportClause === undefined || !ts.isNamedExports(exportClause)) continue
		references.push({
			names: exportClause.elements.flatMap(element => (element.isTypeOnly ? [] : [(element.propertyName ?? element.name).text])),
			specifier,
		})
	}
	return references
}

function collectRuntimeModuleSpecifiers(sourceFile: ts.SourceFile) {
	const specifiers: string[] = []
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			if (!isRuntimeImportDeclaration(statement)) continue
			const specifier = getModuleSpecifierText(statement)
			if (specifier !== undefined) specifiers.push(specifier)
			continue
		}
		if (!ts.isExportDeclaration(statement)) continue
		if (!isRuntimeExportDeclaration(statement)) continue
		const specifier = getModuleSpecifierText(statement)
		if (specifier !== undefined) specifiers.push(specifier)
	}
	return specifiers
}

function isBunStringLiteral(node: ts.Node) {
	return (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === 'bun'
}

function getSourceLocation(sourceFile: ts.SourceFile, node: ts.Node) {
	const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
	const relativePath = path.relative(repositoryRootPath, sourceFile.fileName).replaceAll(path.sep, '/')
	return `${relativePath}:${line + 1}:${character + 1}`
}

function collectBareBunStringLiterals(sourceFile: ts.SourceFile) {
	const locations: string[] = []
	const visit = (node: ts.Node) => {
		if (isBunStringLiteral(node)) {
			locations.push(getSourceLocation(sourceFile, node))
		}
		ts.forEachChild(node, visit)
	}
	visit(sourceFile)
	return locations
}

function getExportedNames(filePath: string, imports: Record<string, string>, exportCache: Map<string, Set<string>>, appRootPath: string) {
	const cachedExports = exportCache.get(filePath)
	if (cachedExports !== undefined) return cachedExports

	const exportedNames = new Set<string>()
	exportCache.set(filePath, exportedNames)
	const sourceFilePath = resolveSourceModulePath(filePath, filePath)
	const effectiveFilePath = sourceFilePath !== undefined && !sourceFilePath.endsWith('.js') && !sourceFilePath.endsWith('.mjs') ? sourceFilePath : filePath
	if (!fs.existsSync(effectiveFilePath)) return exportedNames

	const sourceFile = parseModule(effectiveFilePath, fs.readFileSync(effectiveFilePath, 'utf8'))
	for (const statement of sourceFile.statements) {
		if (ts.isExportDeclaration(statement)) {
			if (!isRuntimeExportDeclaration(statement)) continue
			const exportClause = statement.exportClause
			if (exportClause !== undefined && ts.isNamedExports(exportClause)) {
				for (const element of exportClause.elements) {
					if (element.isTypeOnly) continue
					exportedNames.add(element.name.text)
				}
				continue
			}
			if (exportClause !== undefined && ts.isNamespaceExport(exportClause)) {
				exportedNames.add(exportClause.name.text)
				continue
			}

			const specifier = getModuleSpecifierText(statement)
			if (specifier === undefined) continue
			const resolvedPath = resolveDevelopmentImport(filePath, specifier, imports, appRootPath)
			if (resolvedPath === undefined || !fs.existsSync(resolvedPath.filePath)) continue
			for (const name of getExportedNames(resolvedPath.filePath, imports, exportCache, appRootPath)) {
				if (name !== 'default') exportedNames.add(name)
			}
			continue
		}

		if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
			for (const declaration of statement.declarationList.declarations) {
				for (const name of collectBindingNames(declaration.name)) {
					exportedNames.add(name)
				}
			}
			continue
		}

		if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
			if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
				exportedNames.add('default')
			} else if (statement.name !== undefined) {
				exportedNames.add(statement.name.text)
			}
			continue
		}

		if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
			exportedNames.add('default')
		}
	}
	return exportedNames
}

test('shared helper package imports resolve to browser-served shared outputs', () => {
	const protocolSource = uiProtocolPaths.map(protocolPath => fs.readFileSync(protocolPath, 'utf8')).join('\n')
	const deploymentHelpersSource = fs.readFileSync(uiDeploymentHelpersPath, 'utf8')
	const sepoliaDeploymentConfigSource = fs.readFileSync(uiSepoliaDeploymentConfigPath, 'utf8')
	const simulationBootstrapSource = fs.readFileSync(uiSimulationBootstrapPath, 'utf8')
	const appIndexHtmlSources = [...uiIndexHtmlPaths].map(([appId, indexPath]) => ({ appId, source: fs.readFileSync(indexPath, 'utf8') }))

	expect(protocolSource).toContain("from './helpers.js'")
	expect(protocolSource).toContain("from './deploymentHelpers.js'")
	expect(protocolSource).toContain("from '@zoltar/shared/serialization/bigInt'")
	expect(sepoliaDeploymentConfigSource).toContain("from '@zoltar/shared/deployment/sepoliaRepAllocations'")
	expect(deploymentHelpersSource).toContain("from '@zoltar/shared/deployment/deploymentAddresses'")
	expect(deploymentHelpersSource).toContain("from '@zoltar/shared/oracle/oracleInitialReport'")
	expect(deploymentHelpersSource).toContain("from '@zoltar/shared/deployment/protocolConfig'")
	expect(protocolSource).toContain("from '@zoltar/shared/evm/ethereum'")
	expect(fs.readFileSync(uiReportingDomainPath, 'utf8')).toContain("from '@zoltar/shared/oracle/escalationMath'")
	expect(fs.readFileSync(uiTruthAuctionBookPath, 'utf8')).toContain("from '@zoltar/shared/statoblast/truthAuctionTickMath'")
	expect(protocolSource).not.toContain('./shared/bigInt.js')
	expect(simulationBootstrapSource).not.toContain('../shared/constants.js')
	expect(deploymentHelpersSource).not.toContain('../shared/deploymentAddresses.js')
	for (const { appId, source: uiIndexHtml } of appIndexHtmlSources) {
		expect(uiIndexHtml).toContain('"@zoltar/shared/serialization/bigInt": "../shared/js/serialization/bigInt.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/constants": "../shared/js/constants.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/deployment/deploymentAddresses": "../shared/js/deployment/deploymentAddresses.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/oracle/escalationMath": "../shared/js/oracle/escalationMath.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/evm/ethereum": "../shared/js/evm/ethereum.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/statoblast/liquidation": "../shared/js/statoblast/liquidation.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/evm/logScan": "../shared/js/evm/logScan.js"')
		if (appId !== 'zoltar') {
			expect(uiIndexHtml).toContain('"@zoltar/shared/oracle/openOracle": "../shared/js/oracle/openOracle.js"')
			expect(uiIndexHtml).toContain('"@zoltar/shared/oracle/oracleInitialReport": "../shared/js/oracle/oracleInitialReport.js"')
		} else {
			expect(uiIndexHtml).not.toContain('"@zoltar/shared/oracle/openOracle": "../shared/js/oracle/openOracle.js"')
			expect(uiIndexHtml).not.toContain('"@zoltar/shared/oracle/oracleInitialReport": "../shared/js/oracle/oracleInitialReport.js"')
		}
		expect(uiIndexHtml).toContain('"@zoltar/shared/deployment/protocolConfig": "../shared/js/deployment/protocolConfig.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/statoblast/scalarOutcome": "../shared/js/statoblast/scalarOutcome.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/deployment/sepoliaRepAllocations": "../shared/js/deployment/sepoliaRepAllocations.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/serialization/sortStringArrayByKeccak": "../shared/js/serialization/sortStringArrayByKeccak.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/statoblast/truthAuctionTickMath": "../shared/js/statoblast/truthAuctionTickMath.js"')
		expect(uiIndexHtml).not.toContain('"viem": "./vendor/viem/index.js"')
	}
	expect(sharedBrowserArtifactRelativePaths).toContain('shared/js/statoblast/scalarOutcome.js')
	expect(sharedBrowserArtifactRelativePaths).toContain('shared/js/evm/logScan.js')

	for (const artifactPath of sharedBrowserArtifacts) {
		expect(fs.existsSync(artifactPath)).toBe(true)
	}
})

test('shared browser import maps and required assets follow package export outputs', () => {
	const sharedPackageJson = JSON.parse(fs.readFileSync(sharedPackageJsonPath, 'utf8')) as {
		exports?: Record<string, { default?: string }>
	}
	if (sharedPackageJson.exports === undefined) throw new Error('Expected shared/package.json to define exports.')

	const mappedSharedArtifacts = new Set<string>()
	for (const appId of UI_APP_IDS) {
		const imports = readDevelopmentImportMap(appId)
		for (const [specifier, mappedPath] of Object.entries(imports)) {
			if (!specifier.startsWith('@zoltar/shared/')) continue
			const exportName = `.${specifier.slice('@zoltar/shared'.length)}`
			const packageExport = sharedPackageJson.exports[exportName]
			if (packageExport?.default === undefined) {
				throw new Error(`${appId} maps ${specifier}, but ${exportName} has no default shared package export.`)
			}
			const expectedMappedPath = `../shared/${packageExport.default.replace(/^\.\//, '')}`
			expect(mappedPath, `${appId} import map entry for ${specifier}`).toBe(expectedMappedPath)
			mappedSharedArtifacts.add(`shared/${packageExport.default.replace(/^\.\//, '')}`)
		}
	}

	const exportedArtifacts = new Set(Object.values(sharedPackageJson.exports).flatMap(packageExport => (packageExport.default === undefined ? [] : [`shared/${packageExport.default.replace(/^\.\//, '')}`])))
	for (const relativePath of sharedBrowserArtifactRelativePaths) {
		expect(exportedArtifacts.has(relativePath), `${relativePath} is a current package export output`).toBe(true)
	}
	expect([...mappedSharedArtifacts].sort()).toEqual([...sharedBrowserArtifactRelativePaths].sort())
})

test('watch build regression scanner catches indirect bare Bun commands', () => {
	const fixtureSourceFile = parseModule(path.join(repositoryRootPath, 'tooling', 'ui', 'bare-bun-fixture.mts'), ["const BUN_COMMAND = 'bun'", "spawn(BUN_COMMAND, ['x', 'tsc'])", "runSharedBuildStep([BUN_COMMAND, 'run', 'shared:build'])"].join('\n'))

	expect(collectBareBunStringLiterals(fixtureSourceFile)).toEqual(['tooling/ui/bare-bun-fixture.mts:1:21'])
})

test('development import map maps browser dependency subpaths', () => {
	const vendorBuildSource = fs.readFileSync(uiVendorBuildPath, 'utf8')
	const watchBuildSource = fs.readFileSync(uiWatchBuildPath, 'utf8')
	const workerBuildSource = fs.readFileSync(uiWorkerBuildPath, 'utf8')
	const watchBuildSourceFile = parseModule(uiWatchBuildPath, watchBuildSource)
	const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf8')) as { scripts?: Record<string, string | undefined> }

	for (const appId of UI_APP_IDS) {
		const imports = readDevelopmentImportMap(appId)
		for (const [specifier, mappedPath] of Object.entries(developmentImportMapRegressionEntries)) {
			expect(imports[specifier], `${appId} import map entry for ${specifier}`).toBe(mappedPath)
		}
		if (appId !== 'zoltar') {
			expect(imports['@zoltar/shared/oracle/openOracle']).toBe('../shared/js/oracle/openOracle.js')
		} else {
			expect(imports['@zoltar/shared/oracle/openOracle']).toBeUndefined()
		}
	}
	expect(rootPackageJson.scripts?.['app:watch:zoltar']).toContain('tooling/ui/watch.mts zoltar')
	expect(rootPackageJson.scripts?.['app:watch:statoblast']).toContain('tooling/ui/watch.mts statoblast')
	expect(rootPackageJson.scripts?.['app:serve:zoltar']).toContain('dev-server.ts zoltar')
	expect(rootPackageJson.scripts?.['app:serve:statoblast']).toContain('dev-server.ts statoblast')
	expect(vendorBuildSource).toContain("{ packageName: 'isows', mainEntrypointFile: 'native.js'")
	expect(vendorBuildSource).toContain("includeTrading: parseUiAppIdFromProcess('vendor build') === 'trading'")
	expect(watchBuildSource).toContain("const runProjectArtifactBuild = async (reason: string) => {\n\tif (shuttingDown) return\n\tif (appId === 'trading') {\n\t\tawait runVendorBuild(reason)")
	expect(watchBuildSource).toContain("if (appId === 'trading') {\n\t\tawait runProjectArtifactBuild(reason)")
	expect(watchBuildSource).toContain('if (workerBuildRunning) {\n\t\tvendorBuildQueued = true')
	expect(watchBuildSource).toContain('if (vendorBuildRunning) {\n\t\tworkerBuildQueued = true')
	expect(watchBuildSource).toContain("[WORKER_BUILD_PATH, appId, '--artifacts-current']")
	expect(watchBuildSource).toContain('const VENDOR_INPUT_PATHS = [VENDOR_BUILD_PATH, BUNDLER_PATHS_BUILD_PATH')
	expect(watchBuildSource).toContain('const WORKER_INPUT_PATHS = [WORKER_BUILD_PATH, BUNDLER_PATHS_BUILD_PATH]')
	expect(watchBuildSource).toContain('const BUN_EXECUTABLE_PATH = process.execPath')
	expect(workerBuildSource).toContain("if (appId === 'trading' && !artifactsAreCurrent) await vendor()")
	expect(workerBuildSource).toContain('if (!result.success) throw new Error(`Failed to build the ${appId} simulation worker:')
	expect(collectBareBunStringLiterals(watchBuildSourceFile)).toEqual([])
})

test('vendor cleanup removes stale generated output before regeneration', async () => {
	const temporaryVendorPath = fs.mkdtempSync(path.join(os.tmpdir(), 'zoltar-vendor-'))
	const staleFilePath = path.join(temporaryVendorPath, '@noble', 'curves', 'stale.js')
	fs.mkdirSync(path.dirname(staleFilePath), { recursive: true })
	fs.writeFileSync(staleFilePath, 'stale')

	await clearVendorOutput(temporaryVendorPath)

	expect(fs.existsSync(staleFilePath)).toBe(false)
	expect(fs.existsSync(temporaryVendorPath)).toBe(false)
})

test('vendor build clears generated output before rebuilding assets', async () => {
	const completedSteps: string[] = []

	await vendor({
		clearVendorOutput: async () => {
			completedSteps.push('clearVendorOutput')
		},
		bundleTevm: async () => {
			completedSteps.push('bundleTevm')
		},
		vendorDependencies: async () => {
			completedSteps.push('vendorDependencies')
		},
		copyProjectArtifacts: async () => {
			completedSteps.push('copyProjectArtifacts')
		},
	})

	expect(completedSteps).toEqual(['clearVendorOutput', 'bundleTevm', 'vendorDependencies', 'copyProjectArtifacts'])
})

test('vendor build failures cannot be silently ignored', () => {
	expect(() => assertSuccessfulBuilds([{ success: true, logs: [] }], 'test bundle')).not.toThrow()
	expect(() => assertSuccessfulBuilds([{ success: false, logs: [{ message: 'unresolved import' }] }], 'test bundle')).toThrow('test bundle failed:\nunresolved import')
})

test('project artifact generation writes Trading output only when explicitly requested', async () => {
	const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zoltar-project-artifacts-'))
	const artifactPaths: ProjectArtifactPaths = {
		abiOutputPath: path.join(temporaryRoot, 'ui/coreShared/ts/abis.ts'),
		abiSourcePath: path.join(temporaryRoot, 'solidity/ts/abi/abis.ts'),
		contractArtifactOutputPath: path.join(temporaryRoot, 'ui/coreShared/ts/contractArtifact.ts'),
		contractArtifactsJsonPath: path.join(temporaryRoot, 'solidity/artifacts/Contracts.json'),
		tradingContractArtifactOutputPath: path.join(temporaryRoot, 'ui/trading/ts/generated/contractArtifact.ts'),
	}
	try {
		fs.mkdirSync(path.dirname(artifactPaths.abiOutputPath), { recursive: true })
		fs.mkdirSync(path.dirname(artifactPaths.abiSourcePath), { recursive: true })
		fs.mkdirSync(path.dirname(artifactPaths.contractArtifactsJsonPath), { recursive: true })
		fs.writeFileSync(artifactPaths.abiSourcePath, 'export const abis = {}\n')
		fs.writeFileSync(
			artifactPaths.contractArtifactsJsonPath,
			JSON.stringify({
				contracts: {
					'contracts/Zoltar.sol': { Zoltar: { abi: [] } },
					'contracts/trading/Router.sol': {
						Router: {
							abi: [],
							evm: { bytecode: { object: '6000' }, deployedBytecode: { object: '6001' } },
							storageLayout: { storage: ['not needed at runtime'] },
						},
					},
				},
			}),
		)

		await copyProjectArtifacts({}, artifactPaths)
		expect(fs.readFileSync(artifactPaths.contractArtifactOutputPath, 'utf8')).toContain('Zoltar_Zoltar')
		expect(fs.readFileSync(artifactPaths.contractArtifactOutputPath, 'utf8')).not.toContain('Router_Router')
		expect(fs.existsSync(artifactPaths.tradingContractArtifactOutputPath)).toBe(false)

		await copyProjectArtifacts({ includeTrading: true }, artifactPaths)
		const tradingOutput = fs.readFileSync(artifactPaths.tradingContractArtifactOutputPath, 'utf8')
		expect(tradingOutput).toContain('contracts/trading/Router.sol')
		expect(tradingOutput).toContain('6000')
		expect(tradingOutput).not.toContain('6001')
		expect(tradingOutput).not.toContain('storageLayout')
	} finally {
		fs.rmSync(temporaryRoot, { force: true, recursive: true })
	}

	expect(isCoreProjectContractPath('contracts/Zoltar.sol')).toBe(true)
	expect(isCoreProjectContractPath('contracts/statoblast/SecurityPool.sol')).toBe(true)
	expect(isCoreProjectContractPath('contracts/trading/TwoWayConstantProductRouter.sol')).toBe(false)
})

for (const appId of UI_APP_IDS) {
	test(`development import map resolves all static imports reachable from the ${appId} dev entrypoint`, () => {
		const appPaths = getUiAppPaths(appId)
		const imports = readDevelopmentImportMap(appId)
		const pendingPaths = [path.join(appPaths.appSourceRoot, 'index.dev.ts')]
		const visitedPaths = new Set<string>()
		const exportCache = new Map<string, Set<string>>()
		const unresolvedImports: string[] = []

		while (pendingPaths.length > 0) {
			const currentPath = pendingPaths.pop()
			if (currentPath === undefined) continue
			const withinSharedGeneratedOutput = currentPath.includes(`${path.sep}shared${path.sep}js${path.sep}`)
			if (!withinSharedGeneratedOutput) {
				if (visitedPaths.has(currentPath)) continue
				visitedPaths.add(currentPath)
			}

			if (!fs.existsSync(currentPath)) {
				unresolvedImports.push(`Missing module ${path.relative(repositoryRootPath, currentPath)}`)
				continue
			}

			const source = fs.readFileSync(currentPath, 'utf8')
			const sourceFile = parseModule(currentPath, source)
			for (const specifier of collectRuntimeModuleSpecifiers(sourceFile)) {
				const resolvedPath = resolveDevelopmentImport(currentPath, specifier, imports, appPaths.appRoot)
				if (resolvedPath === undefined) {
					unresolvedImports.push(`${path.relative(repositoryRootPath, currentPath)} imports unmapped bare specifier ${specifier}`)
					continue
				}
				if (!fs.existsSync(resolvedPath.filePath)) {
					unresolvedImports.push(`${path.relative(repositoryRootPath, currentPath)} imports ${specifier}, but ${path.relative(repositoryRootPath, resolvedPath.filePath)} does not exist`)
					continue
				}
				pendingPaths.push(resolvedPath.filePath)
			}

			for (const reference of collectNamedModuleReferences(sourceFile)) {
				const resolvedPath = resolveDevelopmentImport(currentPath, reference.specifier, imports, appPaths.appRoot)
				if (resolvedPath === undefined) {
					unresolvedImports.push(`${path.relative(repositoryRootPath, currentPath)} imports named bindings from unmapped bare specifier ${reference.specifier}`)
					continue
				}
				if (!fs.existsSync(resolvedPath.filePath)) continue
				const exportedNames = getExportedNames(resolvedPath.filePath, imports, exportCache, appPaths.appRoot)
				for (const name of reference.names) {
					if (exportedNames.has(name)) continue
					unresolvedImports.push(`${path.relative(repositoryRootPath, currentPath)} imports ${name} from ${reference.specifier}, but ${path.relative(repositoryRootPath, resolvedPath.filePath)} does not export it`)
				}
			}
		}

		expect(unresolvedImports).toEqual([])
	})
}
