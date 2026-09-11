import { expect, test } from 'bun:test'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { getRequiredContractArtifactRelativePaths, getRequiredSharedOutputRelativePaths, prepareHeadlessContractArtifacts, removeDeprecatedContractArtifactOutputs, removeUnexpectedSharedSourceOutputs } from './ensure-contract-artifacts.mts'

async function exists(filePath: string) {
	try {
		await access(filePath)
		return true
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
		throw error
	}
}

test('ensure-contract-artifacts requires shared package export outputs', async () => {
	const requiredSharedOutputs = await getRequiredSharedOutputRelativePaths()

	expect(requiredSharedOutputs).toContain('shared/core/js/deployment/protocolConfig.js')
	expect(requiredSharedOutputs).toContain('shared/core/js/deployment/protocolConfig.d.ts')
	expect(requiredSharedOutputs).toContain('shared/zoltar/js/questions/scalarOutcome.js')
	expect(requiredSharedOutputs).toContain('shared/zoltar/js/questions/scalarOutcome.d.ts')
})

test('core contract artifact preparation does not require Trading UI output', () => {
	const requiredOutputs = getRequiredContractArtifactRelativePaths()

	expect(requiredOutputs).toContain('ui/coreShared/ts/contractArtifact.ts')
	expect(requiredOutputs).not.toContain('ui/trading/ts/generated/contractArtifact.ts')
})

test('ensure-contract-artifacts reserves root-only shared refreshes for headless preparation', async () => {
	const source = await readFile(new URL('./ensure-contract-artifacts.mts', import.meta.url), 'utf8')
	expect(source).toContain("runBunScript(['./tooling/repo/ensure-shared-package-fresh.mts', '--refresh']")
	expect(source).toContain("runBunScript(['run', 'refresh:shared-dependencies']")
	expect(source).toContain("mode === '--headless'")
	expect(source).toContain('prepareHeadlessContractArtifacts()')
})

test('artifact refresh does not require independently uninstalled UI packages', async () => {
	const packageJson: unknown = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
	if (typeof packageJson !== 'object' || packageJson === null) throw new Error('Root package manifest must be an object')
	const scripts = Reflect.get(packageJson, 'scripts')
	if (typeof scripts !== 'object' || scripts === null) throw new Error('Root package scripts must be an object')

	expect(Reflect.get(scripts, 'refresh:shared-dependencies')).toBe('bun run projects:dependency-update')
	expect(Reflect.get(scripts, 'check:shared-dependencies')).toBe('bun run refresh:shared-dependencies && bun ./tooling/ui/ensure-ui-preact-singleton.mts')
})

test('headless preparation refreshes the root shared install even when artifacts are current', async () => {
	const calls: string[] = []
	await prepareHeadlessContractArtifacts(
		async () => {
			calls.push('refresh')
		},
		async () => {
			calls.push('ensure')
		},
	)
	expect(calls).toEqual(['ensure', 'refresh'])
})

test('headless preparation refreshes the root shared install once when artifacts are rebuilt', async () => {
	const calls: string[] = []
	await prepareHeadlessContractArtifacts(
		async () => {
			calls.push('refresh')
		},
		async refreshSharedDependencies => {
			calls.push('ensure')
			if (refreshSharedDependencies === undefined) throw new Error('Headless preparation did not supply a shared dependency refresh')
			await refreshSharedDependencies()
		},
	)
	expect(calls).toEqual(['ensure', 'refresh'])
})

test('ensure-contract-artifacts removes the deprecated cached contract artifact', async () => {
	const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'zoltar-contract-artifacts-'))
	const deprecatedArtifactPath = path.join(repositoryRoot, 'solidity/types/contractArtifact.ts')
	const currentArtifactPath = path.join(repositoryRoot, 'solidity/ts/types/contractArtifact.ts')
	try {
		await mkdir(path.dirname(deprecatedArtifactPath), { recursive: true })
		await mkdir(path.dirname(currentArtifactPath), { recursive: true })
		await writeFile(deprecatedArtifactPath, 'deprecated')
		await writeFile(currentArtifactPath, 'current')

		await removeDeprecatedContractArtifactOutputs(repositoryRoot)

		expect(await exists(deprecatedArtifactPath)).toBe(false)
		expect(await exists(currentArtifactPath)).toBe(true)
	} finally {
		await rm(repositoryRoot, { force: true, recursive: true })
	}
})

test('ensure-contract-artifacts removes compiled outputs that can shadow shared TypeScript sources', async () => {
	const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'zoltar-shared-source-outputs-'))
	const sharedSourceRoot = path.join(repositoryRoot, 'shared/core/ts')
	try {
		for (const name of ['core', 'zoltar', 'openOracle', 'statoblast', 'trading']) await mkdir(path.join(repositoryRoot, 'shared', name, 'ts'), { recursive: true })
		await mkdir(path.join(sharedSourceRoot, 'nested'), { recursive: true })
		await writeFile(path.join(sharedSourceRoot, 'oracleInitialReport.ts'), 'export const current = true\n')
		await writeFile(path.join(sharedSourceRoot, 'oracleInitialReport.js'), 'export const stale = true\n')
		await writeFile(path.join(sharedSourceRoot, 'oracleInitialReport.js.map'), '{}\n')
		await writeFile(path.join(sharedSourceRoot, 'nested/generated.ts'), 'export const current = true\n')
		await writeFile(path.join(sharedSourceRoot, 'nested/generated.d.ts'), 'export declare const stale: true\n')
		await writeFile(path.join(sharedSourceRoot, 'nested/generated.d.ts.map'), '{}\n')
		await writeFile(path.join(sharedSourceRoot, 'nested/standalone.d.ts'), 'export declare const sourceOnly: true\n')

		await removeUnexpectedSharedSourceOutputs(repositoryRoot)

		expect(await exists(path.join(sharedSourceRoot, 'oracleInitialReport.ts'))).toBe(true)
		expect(await exists(path.join(sharedSourceRoot, 'oracleInitialReport.js'))).toBe(false)
		expect(await exists(path.join(sharedSourceRoot, 'oracleInitialReport.js.map'))).toBe(false)
		expect(await exists(path.join(sharedSourceRoot, 'nested/generated.d.ts'))).toBe(false)
		expect(await exists(path.join(sharedSourceRoot, 'nested/generated.d.ts.map'))).toBe(false)
		expect(await exists(path.join(sharedSourceRoot, 'nested/standalone.d.ts'))).toBe(true)
	} finally {
		await rm(repositoryRoot, { force: true, recursive: true })
	}
})
