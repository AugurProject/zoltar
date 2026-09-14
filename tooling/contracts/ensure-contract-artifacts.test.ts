import { expect, test } from 'bun:test'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { getRequiredContractArtifactRelativePaths, getRequiredSharedOutputRelativePaths, removeDeprecatedContractArtifactOutputs, removeUnexpectedSharedSourceOutputs } from './ensure-contract-artifacts.mts'

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
