/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const zoltarSourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const coreSharedSourceRoot = resolve(zoltarSourceRoot, '../../coreShared/ts')

function resolveZoltarImport(importer: string, specifier: string) {
	let unresolved: string
	if (specifier.startsWith('.')) unresolved = resolve(dirname(importer), specifier)
	else if (specifier.startsWith('@zoltar/ui-zoltar/')) unresolved = resolve(zoltarSourceRoot, specifier.slice('@zoltar/ui-zoltar/'.length))
	else if (specifier.startsWith('@zoltar/ui-core-shared/')) unresolved = resolve(coreSharedSourceRoot, specifier.slice('@zoltar/ui-core-shared/'.length))
	else return undefined
	const candidates = unresolved.endsWith('.js') ? [`${unresolved.slice(0, -3)}.ts`, `${unresolved.slice(0, -3)}.tsx`] : [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`, resolve(unresolved, 'index.ts'), resolve(unresolved, 'index.tsx')]
	return candidates.find(candidate => existsSync(candidate))
}

function collectRuntimeImportSpecifiers(source: string) {
	const runtimeSource = source.replace(/import\s+type[\s\S]*?from\s*['"][^'"]+['"]/g, '')
	const importPattern = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]/g
	return [...runtimeSource.matchAll(importPattern)].flatMap(match => (match[1] === undefined ? [] : [match[1]]))
}

function collectProductionModules(entryPoint: string) {
	const pending = [entryPoint]
	const visited = new Set<string>()
	while (pending.length > 0) {
		const modulePath = pending.pop()
		if (modulePath === undefined || visited.has(modulePath)) continue
		visited.add(modulePath)
		const source = readFileSync(modulePath, 'utf8')
		for (const specifier of collectRuntimeImportSpecifiers(source)) {
			const importedModule = resolveZoltarImport(modulePath, specifier)
			if (importedModule !== undefined) pending.push(importedModule)
		}
	}
	return [...visited]
}

describe('Zoltar production module graph', () => {
	test('collects side-effect imports while excluding type-only imports', () => {
		expect(
			collectRuntimeImportSpecifiers(`
				import './features/open-oracle/register.js'
				import { value } from './value.js'
				import type { TypeOnly } from './type-only.js'
				const lazy = import('./lazy.js')
				void value
				void lazy
			`),
		).toEqual(['./features/open-oracle/register.js', './value.js', './lazy.js'])
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
		const modules = [...new Set(productionEntryPoints.flatMap(collectProductionModules))]
		const forbiddenCopy = modules.flatMap(modulePath => {
			const matches = readFileSync(modulePath, 'utf8').match(/['"`][^'"`\n]*(?:Open Oracle|Statoblast)[^'"`\n]*['"`]/g) ?? []
			return matches.map(copy => ({ copy, modulePath }))
		})

		expect(forbiddenCopy).toEqual([])
	})
})
