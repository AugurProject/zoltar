/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

const zoltarSourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const coreSharedSourceRoot = resolve(zoltarSourceRoot, '../../coreShared/ts')
const zoltarAppShell = resolve(zoltarSourceRoot, '../index.html')

function resolveZoltarImport(importer: string, specifier: string) {
	let unresolved: string
	if (specifier.startsWith('.')) unresolved = resolve(dirname(importer), specifier)
	else if (specifier.startsWith('@zoltar/ui-zoltar/')) unresolved = resolve(zoltarSourceRoot, specifier.slice('@zoltar/ui-zoltar/'.length))
	else if (specifier.startsWith('@zoltar/ui-core-shared/')) unresolved = resolve(coreSharedSourceRoot, specifier.slice('@zoltar/ui-core-shared/'.length))
	else if (specifier.startsWith('@zoltar/ui-')) throw new Error(`Cross-application UI import from ${importer}: ${specifier}`)
	else return undefined
	const isWithinSourceRoot = (sourceRoot: string) => {
		const relativePath = relative(sourceRoot, unresolved)
		return relativePath !== '..' && !relativePath.startsWith('../')
	}
	if (!isWithinSourceRoot(zoltarSourceRoot) && !isWithinSourceRoot(coreSharedSourceRoot)) throw new Error(`Cross-application UI import from ${importer}: ${specifier}`)
	const candidates = unresolved.endsWith('.js') ? [`${unresolved.slice(0, -3)}.ts`, `${unresolved.slice(0, -3)}.tsx`] : [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`, resolve(unresolved, 'index.ts'), resolve(unresolved, 'index.tsx')]
	return candidates.find(candidate => existsSync(candidate))
}

function createSourceFile(modulePath: string, source: string) {
	const diagnostics =
		ts
			.transpileModule(source, {
				compilerOptions: { jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.Latest },
				fileName: modulePath,
				reportDiagnostics: true,
			})
			.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error) ?? []
	if (diagnostics.length > 0) {
		const messages = diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n')
		throw new Error(`Unable to parse ${modulePath}:\n${messages}`)
	}
	return ts.createSourceFile(modulePath, source, ts.ScriptTarget.Latest, true)
}

function hasRuntimeImportBindings(importClause: ts.ImportClause | undefined) {
	if (importClause === undefined) return true
	if (importClause.isTypeOnly) return false
	if (importClause.name !== undefined) return true
	const namedBindings = importClause.namedBindings
	if (namedBindings === undefined || ts.isNamespaceImport(namedBindings)) return true
	return namedBindings.elements.some(element => !element.isTypeOnly)
}

function hasRuntimeExportBindings(exportDeclaration: ts.ExportDeclaration) {
	if (exportDeclaration.isTypeOnly) return false
	const exportClause = exportDeclaration.exportClause
	if (exportClause === undefined || ts.isNamespaceExport(exportClause)) return true
	return exportClause.elements.some(element => !element.isTypeOnly)
}

function collectRuntimeImportSpecifiers(source: string, modulePath: string) {
	const specifiers: string[] = []
	function visit(node: ts.Node) {
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && hasRuntimeImportBindings(node.importClause)) {
			specifiers.push(node.moduleSpecifier.text)
		} else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier) && hasRuntimeExportBindings(node)) {
			specifiers.push(node.moduleSpecifier.text)
		} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const [specifier] = node.arguments
			if (specifier === undefined || (!ts.isStringLiteral(specifier) && !ts.isNoSubstitutionTemplateLiteral(specifier))) throw new Error(`Nonliteral dynamic import in ${modulePath}`)
			specifiers.push(specifier.text)
		}
		ts.forEachChild(node, visit)
	}
	visit(createSourceFile(modulePath, source))
	return specifiers
}

function collectForbiddenProductReferences(source: string, modulePath: string) {
	const matches = new Set<string>()
	function collectStaticExpressionText(node: ts.Expression): string | undefined {
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
		if (ts.isParenthesizedExpression(node)) return collectStaticExpressionText(node.expression)
		if (ts.isTemplateExpression(node)) return collectTemplateStaticText(node)
		if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.PlusToken) return undefined
		const left = collectStaticExpressionText(node.left)
		const right = collectStaticExpressionText(node.right)
		return left === undefined || right === undefined ? undefined : left + right
	}
	function collectTemplateStaticText(node: ts.TemplateExpression) {
		return node.head.text + node.templateSpans.map(span => (collectStaticExpressionText(span.expression) ?? '') + span.literal.text).join('')
	}
	function collectJsxStaticText(node: ts.Node): string {
		if (ts.isJsxText(node)) return node.text
		if (ts.isJsxElement(node) || ts.isJsxFragment(node)) return node.children.map(collectJsxStaticText).join('')
		if (!ts.isJsxExpression(node) || node.expression === undefined) return ''
		return collectStaticExpressionText(node.expression) ?? ''
	}
	function collect(value: string) {
		if (/\bopen(?:\s|-)*oracle|\bstatoblast|#\/(?:security-pools?|markets?)(?:[/?#]|$)/i.test(value)) matches.add(value)
	}
	function visit(node: ts.Node) {
		if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) collect(node.text)
		else if (ts.isTemplateExpression(node)) collect(collectTemplateStaticText(node))
		else if (ts.isBinaryExpression(node)) {
			const staticText = collectStaticExpressionText(node)
			if (staticText !== undefined) collect(staticText)
		} else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) collect(collectJsxStaticText(node))
		ts.forEachChild(node, visit)
	}
	visit(createSourceFile(modulePath, source))
	return [...matches]
}

function isAllowedTechnicalProductString(modulePath: string, value: string) {
	if (value === 'statoblast') return modulePath.endsWith('/lib/activeEnvironment.ts') || modulePath.endsWith('/simulation/tevmBackend.ts')
	if (value === 'statoblast_Multicall3_Multicall3') return modulePath.endsWith('/protocol/deployment.ts') || modulePath.endsWith('/protocol/zoltarDeploymentHelpers.ts')
	if (value === 'statoblast_WETH9_WETH9') return modulePath.endsWith('/lib/sepoliaDeploymentConfig.ts') || modulePath.endsWith('/simulation/bootstrap.ts') || modulePath.endsWith('/protocol/deployment.ts')
	return false
}

function collectProductionModules(entryPoint: string) {
	const pending = [entryPoint]
	const visited = new Set<string>()
	while (pending.length > 0) {
		const modulePath = pending.pop()
		if (modulePath === undefined || visited.has(modulePath)) continue
		visited.add(modulePath)
		const source = readFileSync(modulePath, 'utf8')
		for (const specifier of collectRuntimeImportSpecifiers(source, modulePath)) {
			const importedModule = resolveZoltarImport(modulePath, specifier)
			if (importedModule !== undefined) pending.push(importedModule)
		}
	}
	return [...visited]
}

describe('Zoltar production module graph', () => {
	test('collects every runtime module edge while excluding type-only imports and exports', () => {
		expect(
			collectRuntimeImportSpecifiers(
				`
					import './features/open-oracle/register.js'
					import { value } from './value.js'
					import type { TypeOnly } from './type-only.js'
					import { type AlsoTypeOnly } from './also-type-only.js'
					export { runtimeValue } from './runtime-export.js'
					export type { ExportedType } from './type-export.js'
					const lazy = import('./lazy.js')
					const templateLazy = import(\`./template-lazy.js\`)
					void value
					void lazy
					void templateLazy
				`,
				'fixture.ts',
			),
		).toEqual(['./features/open-oracle/register.js', './value.js', './runtime-export.js', './lazy.js', './template-lazy.js'])
	})

	test('recognizes forbidden product copy across branding, casing, and multiline variants', () => {
		expect(
			collectForbiddenProductReferences(
				`
					const spaced = 'Open Oracle'
					const compact = 'OpenOracle report'
					const mixedCase = 'sTaToBlAsT'
					const multiline = \`Open
						Oracle\`
					const jsxCopy = <p>Statoblast</p>
				`,
				'fixture.tsx',
			),
		).toEqual(['Open Oracle', 'OpenOracle report', 'sTaToBlAsT', 'Open\n\t\t\t\t\t\tOracle', 'Statoblast'])
	})

	test('parses TypeScript generic arrows before later runtime edges and product copy', () => {
		const source = `
			const identity = <TValue>(value: TValue) => value
			const lazy = import('./after-generic.js')
			const forbidden = 'Open Oracle'
			void identity
			void lazy
			void forbidden
		`

		expect(collectRuntimeImportSpecifiers(source, 'fixture.ts')).toEqual(['./after-generic.js'])
		expect(collectForbiddenProductReferences(source, 'fixture.ts')).toEqual(['Open Oracle'])
	})

	test('rejects dynamic imports whose target cannot be resolved statically', () => {
		expect(() => collectRuntimeImportSpecifiers("const feature = 'open-oracle'; void import(`./features/${feature}/register.js`)", 'fixture.ts')).toThrow('Nonliteral dynamic import')
		expect(() => collectRuntimeImportSpecifiers("const feature = 'open-oracle'; void import(`./features/${feature}/register.js`)", 'fixture.tsx')).toThrow('Nonliteral dynamic import')
	})

	test('recognizes forbidden product copy composed across templates and nested JSX', () => {
		expect(collectForbiddenProductReferences('const copy = `Open Oracle ${suffix}`', 'fixture.ts')).toContain('Open Oracle ')
		expect(collectForbiddenProductReferences('const copy = <span>Open <em>Oracle</em></span>', 'fixture.tsx')).toContain('Open Oracle')
	})

	test('rejects runtime imports owned by another internal UI application', () => {
		const importer = resolve(zoltarSourceRoot, 'app/App.tsx')
		expect(() => resolveZoltarImport(importer, '@zoltar/ui-statoblast/app/App.js')).toThrow('Cross-application UI import')
		expect(() => resolveZoltarImport(importer, '../../../statoblast/ts/app/App.js')).toThrow('Cross-application UI import')
	})

	test('recognizes statically concatenated branding and cross-product link destinations', () => {
		expect(collectForbiddenProductReferences("const copy = 'Open ' + 'Oracle'", 'fixture.ts')).toContain('Open Oracle')
		expect(collectForbiddenProductReferences("const link = <a href='#/security-pools'>Pools</a>", 'fixture.tsx')).toContain('#/security-pools')
	})

	test('recognizes forbidden product identifiers and element-access keys', () => {
		const references = collectForbiddenProductReferences("const openOracleView = state['statoblastSecurityMultiplierBps']", 'fixture.ts')

		expect(references).toContain('openOracleView')
		expect(references).toContain('statoblastSecurityMultiplierBps')
	})

	test('does not declare forbidden product modules or copy in the application shell', () => {
		const appShell = readFileSync(zoltarAppShell, 'utf8')

		expect(appShell.match(/\bopen(?:\s|-)*oracle|\bstatoblast|@zoltar\/shared\/oracleInitialReport/i)).toBeNull()
	})

	test('does not reach Statoblast-only protocol or presentation modules', () => {
		const productionEntryPoints = [resolve(zoltarSourceRoot, 'index.ts'), resolve(zoltarSourceRoot, 'simulation/tevmWorker.ts')]
		const modules = [...new Set(productionEntryPoints.flatMap(collectProductionModules))]
		const forbiddenPaths = ['/app/hooks/useUrlState.ts', '/features/open-oracle/', '/features/reporting/', '/features/transactionPresentations.tsx', '/protocol/deploymentHelpers.ts', '/protocol/forks.ts', '/protocol/index.ts', '/protocol/openOracle.ts', '/protocol/reporting.ts']

		expect(modules.filter(modulePath => forbiddenPaths.some(forbiddenPath => modulePath.endsWith(forbiddenPath) || modulePath.includes(forbiddenPath)))).toEqual([])
		const statoblastArtifactImports = modules
			.filter(modulePath => !modulePath.endsWith('/contractArtifact.ts'))
			.flatMap(modulePath => readFileSync(modulePath, 'utf8').match(/\bstatoblast_[A-Za-z0-9_]+/g) ?? [])
			.filter(identifier => identifier !== 'statoblast_Multicall3_Multicall3' && identifier !== 'statoblast_WETH9_WETH9')
		expect([...new Set(statoblastArtifactImports)]).toEqual([])
	})

	test('does not load source modules containing forbidden product copy', () => {
		const productionEntryPoints = [resolve(zoltarSourceRoot, 'index.ts'), resolve(zoltarSourceRoot, 'simulation/tevmWorker.ts')]
		const modules = [...new Set(productionEntryPoints.flatMap(collectProductionModules))].filter(modulePath => !modulePath.endsWith('/contractArtifact.ts'))
		const forbiddenCopy = modules.flatMap(modulePath =>
			collectForbiddenProductReferences(readFileSync(modulePath, 'utf8'), modulePath)
				.filter(copy => !isAllowedTechnicalProductString(modulePath, copy))
				.map(copy => ({ copy, modulePath })),
		)

		expect(forbiddenCopy).toEqual([])
	})
})
