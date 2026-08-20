import { expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as ts from 'typescript'
import { sharedBrowserArtifactRelativePaths } from '../../../scripts/sharedBrowserArtifacts.ts'
import { clearVendorOutput, vendor } from './vendor.mts'
import { UI_APP_IDS, getUiAppPaths, getUiCoreSharedPaths } from './appPaths.mts'

const coreSharedPaths = getUiCoreSharedPaths()
const appPathsById = new Map(UI_APP_IDS.map(appId => [appId, getUiAppPaths(appId)]))
const zoltarPaths = appPathsById.get('zoltar')
const statoblastPaths = appPathsById.get('statoblast')
if (zoltarPaths === undefined || statoblastPaths === undefined) throw new Error('Failed to resolve the UI application paths.')
const repositoryRootPath = coreSharedPaths.repositoryRoot
const uiRootPath = coreSharedPaths.uiRoot
const uiProtocolPaths = [path.join(zoltarPaths.appSourceRoot, 'protocol', 'forks.ts'), path.join(zoltarPaths.appSourceRoot, 'protocol', 'openOracle.ts'), path.join(statoblastPaths.appSourceRoot, 'protocol', 'trading.ts')]
const uiDeploymentHelpersPath = path.join(zoltarPaths.appSourceRoot, 'protocol', 'deploymentHelpers.ts')
const uiReportingDomainPath = path.join(zoltarPaths.appSourceRoot, 'features', 'reporting', 'lib', 'reportingDomain.ts')
const uiSepoliaDeploymentConfigPath = path.join(coreSharedPaths.coreSharedSourceRoot, 'lib', 'sepoliaDeploymentConfig.ts')
const uiSimulationBootstrapPath = path.join(coreSharedPaths.coreSharedSourceRoot, 'simulation', 'bootstrap.ts')
const uiTruthAuctionBookPath = path.join(statoblastPaths.appSourceRoot, 'features', 'truth-auctions', 'lib', 'truthAuctionBook.ts')
const uiIndexHtmlPaths = new Map(UI_APP_IDS.map(appId => [appId, path.join(uiRootPath, appId, 'index.html')]))
const uiVendorBuildPath = path.join(coreSharedPaths.coreSharedRoot, 'build', 'vendor.mts')
const uiWatchBuildPath = path.join(coreSharedPaths.coreSharedRoot, 'build', 'watch.mts')
const rootPackageJsonPath = path.join(repositoryRootPath, 'package.json')
const sharedBrowserArtifacts = sharedBrowserArtifactRelativePaths.map(relativePath => path.join(repositoryRootPath, relativePath))
const developmentImportMapRegressionEntries: Record<string, string> = {
	'@zoltar/shared/ethereum': '../shared/js/ethereum.js',
	'@zoltar/shared/openOracle': '../shared/js/openOracle.js',
	'@zoltar/shared/scalarOutcome': '../shared/js/scalarOutcome.js',
	'@zoltar/shared/sepoliaRepAllocations': '../shared/js/sepoliaRepAllocations.js',
	'@zoltar/shared/sortStringArrayByKeccak': '../shared/js/sortStringArrayByKeccak.js',
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
	const appIndexHtmlSources = [...uiIndexHtmlPaths.values()].map(indexPath => fs.readFileSync(indexPath, 'utf8'))

	expect(protocolSource).toContain("from './helpers.js'")
	expect(protocolSource).toContain("from './deploymentHelpers.js'")
	expect(protocolSource).toContain("from '@zoltar/shared/bigInt'")
	expect(sepoliaDeploymentConfigSource).toContain("from '@zoltar/shared/sepoliaRepAllocations'")
	expect(deploymentHelpersSource).toContain("from '@zoltar/shared/deploymentAddresses'")
	expect(deploymentHelpersSource).toContain("from '@zoltar/shared/oracleInitialReport'")
	expect(deploymentHelpersSource).toContain("from '@zoltar/shared/protocolConfig'")
	expect(protocolSource).toContain("from '@zoltar/shared/ethereum'")
	expect(fs.readFileSync(uiReportingDomainPath, 'utf8')).toContain("from '@zoltar/shared/escalationMath'")
	expect(fs.readFileSync(uiTruthAuctionBookPath, 'utf8')).toContain("from '@zoltar/shared/truthAuctionTickMath'")
	expect(protocolSource).not.toContain('./shared/bigInt.js')
	expect(simulationBootstrapSource).not.toContain('../shared/constants.js')
	expect(deploymentHelpersSource).not.toContain('../shared/deploymentAddresses.js')
	for (const uiIndexHtml of appIndexHtmlSources) {
		expect(uiIndexHtml).toContain('"@zoltar/shared/bigInt": "../shared/js/bigInt.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/constants": "../shared/js/constants.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/deploymentAddresses": "../shared/js/deploymentAddresses.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/escalationMath": "../shared/js/escalationMath.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/ethereum": "../shared/js/ethereum.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/liquidation": "../shared/js/liquidation.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/openOracle": "../shared/js/openOracle.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/oracleInitialReport": "../shared/js/oracleInitialReport.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/protocolConfig": "../shared/js/protocolConfig.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/scalarOutcome": "../shared/js/scalarOutcome.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/sepoliaRepAllocations": "../shared/js/sepoliaRepAllocations.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/sortStringArrayByKeccak": "../shared/js/sortStringArrayByKeccak.js"')
		expect(uiIndexHtml).toContain('"@zoltar/shared/truthAuctionTickMath": "../shared/js/truthAuctionTickMath.js"')
		expect(uiIndexHtml).not.toContain('"viem": "./vendor/viem/index.js"')
	}
	expect(sharedBrowserArtifactRelativePaths).toContain('shared/js/scalarOutcome.js')

	for (const artifactPath of sharedBrowserArtifacts) {
		expect(fs.existsSync(artifactPath)).toBe(true)
	}
})

test('watch build regression scanner catches indirect bare Bun commands', () => {
	const fixtureSourceFile = parseModule(path.join(repositoryRootPath, 'ui', 'coreShared', 'build', 'bare-bun-fixture.mts'), ["const BUN_COMMAND = 'bun'", "spawn(BUN_COMMAND, ['x', 'tsc'])", "runSharedBuildStep([BUN_COMMAND, 'run', 'shared:build'])"].join('\n'))

	expect(collectBareBunStringLiterals(fixtureSourceFile)).toEqual(['ui/coreShared/build/bare-bun-fixture.mts:1:21'])
})

test('development import map maps browser dependency subpaths', () => {
	const vendorBuildSource = fs.readFileSync(uiVendorBuildPath, 'utf8')
	const watchBuildSource = fs.readFileSync(uiWatchBuildPath, 'utf8')
	const watchBuildSourceFile = parseModule(uiWatchBuildPath, watchBuildSource)
	const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf8')) as { scripts?: Record<string, string | undefined> }

	for (const appId of UI_APP_IDS) {
		const imports = readDevelopmentImportMap(appId)
		for (const [specifier, mappedPath] of Object.entries(developmentImportMapRegressionEntries)) {
			expect(imports[specifier], `${appId} import map entry for ${specifier}`).toBe(mappedPath)
		}
	}
	expect(rootPackageJson.scripts?.['app:watch:zoltar']).toContain('build/watch.mts zoltar')
	expect(rootPackageJson.scripts?.['app:watch:statoblast']).toContain('build/watch.mts statoblast')
	expect(rootPackageJson.scripts?.['app:serve:zoltar']).toContain('dev-server.ts zoltar')
	expect(rootPackageJson.scripts?.['app:serve:statoblast']).toContain('dev-server.ts statoblast')
	expect(vendorBuildSource).toContain("{ packageName: 'isows', subfolderToVendor: '_esm', mainEntrypointFile: 'native.js'")
	expect(watchBuildSource).toContain('const VENDOR_INPUT_PATHS = [VENDOR_BUILD_PATH, BUNDLER_PATHS_BUILD_PATH')
	expect(watchBuildSource).toContain('const WORKER_INPUT_PATHS = [WORKER_BUILD_PATH, BUNDLER_PATHS_BUILD_PATH]')
	expect(watchBuildSource).toContain('const BUN_EXECUTABLE_PATH = process.execPath')
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

for (const appId of UI_APP_IDS) {
	test(`development import map resolves all static imports reachable from the ${appId} dev entrypoint`, () => {
		const appPaths = appPathsById.get(appId)
		if (appPaths === undefined) throw new Error(`No path information recorded for ${appId}.`)
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
