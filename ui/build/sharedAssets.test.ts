import { expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import * as ts from 'typescript'
import { sharedBrowserArtifactRelativePaths } from '../../scripts/sharedBrowserArtifacts.ts'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(directoryOfThisFile, '..', '..')
const uiRootPath = path.join(repositoryRootPath, 'ui')
const uiContractsPath = path.join(repositoryRootPath, 'ui', 'ts', 'contracts.ts')
const uiDeploymentHelpersPath = path.join(repositoryRootPath, 'ui', 'ts', 'contracts', 'deploymentHelpers.ts')
const uiReportingDomainPath = path.join(repositoryRootPath, 'ui', 'ts', 'lib', 'reportingDomain.ts')
const uiSimulationBootstrapPath = path.join(repositoryRootPath, 'ui', 'ts', 'simulation', 'bootstrap.ts')
const uiTruthAuctionBookPath = path.join(repositoryRootPath, 'ui', 'ts', 'lib', 'truthAuctionBook.ts')
const uiIndexHtmlPath = path.join(repositoryRootPath, 'ui', 'index.html')
const uiVendorBuildPath = path.join(repositoryRootPath, 'ui', 'build', 'vendor.mts')
const uiDevelopmentEntrypointPath = path.join(repositoryRootPath, 'ui', 'ts', 'index.dev.ts')
const sharedBrowserArtifacts = sharedBrowserArtifactRelativePaths.map(relativePath => path.join(repositoryRootPath, relativePath))
const developmentImportMapRegressionEntries: Record<string, string> = {
	viem: './vendor/viem/index.js',
	abitype: './vendor/abitype/exports/index.js',
	'@noble/hashes/sha2': './vendor/@noble/hashes/sha2.js',
	'@noble/hashes/sha3': './vendor/@noble/hashes/sha3.js',
	'@noble/curves/secp256k1': './vendor/@noble/curves/secp256k1.js',
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

type ResolvedImport =
	| {
			filePath: string
			kind: 'file'
	  }
	| {
			kind: 'mapped-vendor'
	  }

function readDevelopmentImportMap(): Record<string, string> {
	const uiIndexHtml = fs.readFileSync(uiIndexHtmlPath, 'utf8')
	const importMapMatch = uiIndexHtml.match(/<script\s+type=['"]importmap['"][^>]*>([\s\S]*?)<\/script>/)
	if (importMapMatch === null || importMapMatch[1] === undefined) {
		throw new Error('Expected ui/index.html to contain a development import map script.')
	}
	const importMap = JSON.parse(importMapMatch[1]) as ImportMapFile
	if (importMap.imports === undefined) {
		throw new Error('Expected development import map to include imports.')
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

function resolveDevelopmentImport(fromPath: string, specifier: string, imports: Record<string, string>) {
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
	if (mappedSpecifier === undefined) return undefined
	if (mappedSpecifier.startsWith('./vendor/')) {
		return {
			kind: 'mapped-vendor',
		} satisfies ResolvedImport
	}

	return {
		filePath: path.resolve(uiRootPath, mappedSpecifier),
		kind: 'file',
	} satisfies ResolvedImport
}

function resolveSourceModulePath(fromPath: string, specifier: string) {
	const rawResolvedPath = path.resolve(path.dirname(fromPath), specifier)
	const candidatePaths = [rawResolvedPath]
	if (rawResolvedPath.endsWith('.js')) {
		const withoutJavaScriptExtension = rawResolvedPath.slice(0, -'.js'.length)
		candidatePaths.push(`${withoutJavaScriptExtension}.ts`, `${withoutJavaScriptExtension}.tsx`, `${withoutJavaScriptExtension}.mts`)
	}
	candidatePaths.push(path.join(rawResolvedPath, 'index.ts'), path.join(rawResolvedPath, 'index.tsx'), path.join(rawResolvedPath, 'index.js'))

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

function getExportedNames(filePath: string, imports: Record<string, string>, exportCache: Map<string, Set<string>>) {
	const cachedExports = exportCache.get(filePath)
	if (cachedExports !== undefined) return cachedExports

	const exportedNames = new Set<string>()
	exportCache.set(filePath, exportedNames)
	if (!fs.existsSync(filePath)) return exportedNames

	const sourceFile = parseModule(filePath, fs.readFileSync(filePath, 'utf8'))
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
			const resolvedPath = resolveDevelopmentImport(filePath, specifier, imports)
			if (resolvedPath === undefined || resolvedPath.kind === 'mapped-vendor') continue
			for (const name of getExportedNames(resolvedPath.filePath, imports, exportCache)) {
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
	const contractsSource = fs.readFileSync(uiContractsPath, 'utf8')
	const deploymentHelpersSource = fs.readFileSync(uiDeploymentHelpersPath, 'utf8')
	const simulationBootstrapSource = fs.readFileSync(uiSimulationBootstrapPath, 'utf8')
	const uiIndexHtml = fs.readFileSync(uiIndexHtmlPath, 'utf8')

	expect(contractsSource).toContain("from './contracts/helpers.js'")
	expect(contractsSource).toContain("from './contracts/deploymentHelpers.js'")
	expect(contractsSource).toContain("from '@zoltar/shared/bigInt'")
	expect(simulationBootstrapSource).toContain("from '@zoltar/shared/constants'")
	expect(deploymentHelpersSource).toContain("from '@zoltar/shared/deploymentAddresses'")
	expect(deploymentHelpersSource).toContain("from '@zoltar/shared/protocolConfig'")
	expect(fs.readFileSync(uiReportingDomainPath, 'utf8')).toContain("from '@zoltar/shared/escalationMath'")
	expect(fs.readFileSync(uiTruthAuctionBookPath, 'utf8')).toContain("from '@zoltar/shared/truthAuctionTickMath'")
	expect(contractsSource).not.toContain('./shared/bigInt.js')
	expect(simulationBootstrapSource).not.toContain('../shared/constants.js')
	expect(deploymentHelpersSource).not.toContain('../shared/deploymentAddresses.js')
	expect(uiIndexHtml).toContain('"@zoltar/shared/bigInt": "../shared/js/bigInt.js"')
	expect(uiIndexHtml).toContain('"@zoltar/shared/constants": "../shared/js/constants.js"')
	expect(uiIndexHtml).toContain('"@zoltar/shared/deploymentAddresses": "../shared/js/deploymentAddresses.js"')
	expect(uiIndexHtml).toContain('"@zoltar/shared/escalationMath": "../shared/js/escalationMath.js"')
	expect(uiIndexHtml).toContain('"@zoltar/shared/protocolConfig": "../shared/js/protocolConfig.js"')
	expect(uiIndexHtml).toContain('"@zoltar/shared/truthAuctionTickMath": "../shared/js/truthAuctionTickMath.js"')

	for (const artifactPath of sharedBrowserArtifacts) {
		expect(fs.existsSync(artifactPath)).toBe(true)
	}
})

test('development import map maps browser dependency subpaths', () => {
	const imports = readDevelopmentImportMap()
	const vendorBuildSource = fs.readFileSync(uiVendorBuildPath, 'utf8')

	for (const [specifier, mappedPath] of Object.entries(developmentImportMapRegressionEntries)) {
		expect(imports[specifier]).toBe(mappedPath)
	}
	expect(vendorBuildSource).toContain("{ packageName: 'isows', subfolderToVendor: '_esm', mainEntrypointFile: 'native.js'")
})

test('development import map resolves all static imports reachable from the dev entrypoint', () => {
	const imports = readDevelopmentImportMap()
	const pendingPaths = [uiDevelopmentEntrypointPath]
	const visitedPaths = new Set<string>()
	const exportCache = new Map<string, Set<string>>()
	const unresolvedImports: string[] = []

	while (pendingPaths.length > 0) {
		const currentPath = pendingPaths.pop()
		if (currentPath === undefined || visitedPaths.has(currentPath)) continue
		visitedPaths.add(currentPath)

		if (!fs.existsSync(currentPath)) {
			unresolvedImports.push(`Missing module ${path.relative(repositoryRootPath, currentPath)}`)
			continue
		}

		const source = fs.readFileSync(currentPath, 'utf8')
		const sourceFile = parseModule(currentPath, source)
		for (const specifier of collectRuntimeModuleSpecifiers(sourceFile)) {
			const resolvedPath = resolveDevelopmentImport(currentPath, specifier, imports)
			if (resolvedPath === undefined) {
				unresolvedImports.push(`${path.relative(repositoryRootPath, currentPath)} imports unmapped bare specifier ${specifier}`)
				continue
			}
			if (resolvedPath.kind === 'mapped-vendor') continue
			if (!fs.existsSync(resolvedPath.filePath)) {
				unresolvedImports.push(`${path.relative(repositoryRootPath, currentPath)} imports ${specifier}, but ${path.relative(repositoryRootPath, resolvedPath.filePath)} does not exist`)
				continue
			}
			pendingPaths.push(resolvedPath.filePath)
		}

		for (const reference of collectNamedModuleReferences(sourceFile)) {
			const resolvedPath = resolveDevelopmentImport(currentPath, reference.specifier, imports)
			if (resolvedPath === undefined) {
				unresolvedImports.push(`${path.relative(repositoryRootPath, currentPath)} imports named bindings from unmapped bare specifier ${reference.specifier}`)
				continue
			}
			if (resolvedPath.kind === 'mapped-vendor' || !fs.existsSync(resolvedPath.filePath)) continue
			const exportedNames = getExportedNames(resolvedPath.filePath, imports, exportCache)
			for (const name of reference.names) {
				if (exportedNames.has(name)) continue
				unresolvedImports.push(`${path.relative(repositoryRootPath, currentPath)} imports ${name} from ${reference.specifier}, but ${path.relative(repositoryRootPath, resolvedPath.filePath)} does not export it`)
			}
		}
	}

	expect(unresolvedImports).toEqual([])
})
