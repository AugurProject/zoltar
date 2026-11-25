import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { generatedCacheKey, projectQuery } from './query-projects.mts'

test('query exposes registry-owned cache and artifact inputs', async () => {
	const query = await projectQuery()
	expect(query.setupProjectPaths).toContain('bots/chaos')
	expect(new Set(query.setupProjectPaths).size).toBe(query.setupProjectPaths.length)
	expect(query.componentArtifactOutputs).toContain('ui/trading/ts/generated/contractArtifact.ts')
	expect(query.uiArtifactOutputs).toContain('ui/coreShared/js')
	expect(query.uiArtifactOutputs).toContain('ui/trading/dist')
	expect(query.dependencyCacheKey).toHaveLength(64)
	expect(query.generatedCacheKey).toHaveLength(64)
})

test('CI cache profiles retain artifact paths and return only the requested keys', async () => {
	const [paths, dependencies, contracts] = await Promise.all([projectQuery('paths'), projectQuery('dependencies'), projectQuery('contracts')])
	expect(paths).toMatchObject({ dependencyCacheKey: '', generatedCacheKey: '', contractCacheKey: '' })
	expect(dependencies).toMatchObject({ generatedCacheKey: '', contractCacheKey: '', generatedCachePaths: paths.generatedCachePaths })
	expect(dependencies.dependencyCacheKey).toHaveLength(64)
	expect(contracts).toMatchObject({ dependencyCacheKey: dependencies.dependencyCacheKey, generatedCacheKey: '', componentArtifactOutputs: paths.componentArtifactOutputs })
	expect(contracts.contractCacheKey).toHaveLength(64)
})

test('transferred build inputs preserve shared freshness so consumers do not rebuild them', async () => {
	const query = await projectQuery()
	expect(query.componentArtifactOutputs).toContain('shared/.freshness-hash')
	expect(query.generatedCachePaths).toContain('shared/.freshness-hash')
	expect(query.fullOnlyCachePaths).toContain('ui/zoltar/vendor')
	// The shared stylesheet's fonts are vendored outside every app vendor directory.
	expect(query.fullOnlyCachePaths).toContain('ui/coreShared/vendor/fonts')
	expect(query.fullOnlyCachePaths).toContain('augurScan/config/abis.json')
	expect(query.fullOnlyCachePaths.some(output => query.componentArtifactOutputs.includes(output))).toBe(false)
	expect([...query.fullOnlyCachePaths, ...query.componentArtifactOutputs].sort()).toEqual([...query.generatedCachePaths].sort())
})

test('contract cache ignores unrelated UI and explorer inputs but tracks contract producers and shared dependencies', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'ci-cache-inputs-'))
	try {
		const setInput = async (file: string, contents: string) => {
			await mkdir(path.dirname(path.join(root, file)), { recursive: true })
			await writeFile(path.join(root, file), contents)
		}
		for (const file of ['ui/zoltar/package.json', 'tooling/ui/vendor.mts', 'augurScan/browser/app.ts', 'augurScan/src/collateral.ts']) {
			const contractBefore = await generatedCacheKey('contracts', root)
			const fullBefore = await generatedCacheKey('full', root)
			await setInput(file, 'changed')
			expect(await generatedCacheKey('contracts', root)).toBe(contractBefore)
			expect(await generatedCacheKey('full', root)).not.toBe(fullBefore)
		}
		for (const file of [
			'bun.lock',
			'package.json',
			'solidity/contracts/Test.sol',
			'solidity/ts/compile.ts',
			'solidity/ts/contractProjects.ts',
			'shared/core/ts/test-input.ts',
			'shared/tsconfig.base.json',
			'tooling/ui/projectArtifacts.mts',
			'tooling/contracts/ensure-contract-artifacts.mts',
			'tooling/repo/projects.ts',
		]) {
			const before = await generatedCacheKey('contracts', root)
			await setInput(file, 'first')
			const added = await generatedCacheKey('contracts', root)
			expect(added).not.toBe(before)
			await setInput(file, 'second')
			expect(await generatedCacheKey('contracts', root)).not.toBe(added)
			await rm(path.join(root, file))
			expect(await generatedCacheKey('contracts', root)).toBe(before)
		}
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
