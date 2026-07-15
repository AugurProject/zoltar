import { expect, test } from 'bun:test'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { getRequiredSharedOutputRelativePaths, removeDeprecatedContractArtifactOutputs } from './ensure-contract-artifacts.mts'

async function exists(filePath: string) {
	try {
		await access(filePath)
		return true
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
		throw error
	}
}

test('ensure-contract-artifacts requires shared package testing helper outputs', async () => {
	const requiredSharedOutputs = await getRequiredSharedOutputRelativePaths()

	expect(requiredSharedOutputs).toContain('shared/js/protocolConfig.js')
	expect(requiredSharedOutputs).toContain('shared/js/protocolConfig.d.ts')
	expect(requiredSharedOutputs).toContain('shared/js/testing/pickFixtureProperties.js')
	expect(requiredSharedOutputs).toContain('shared/js/testing/pickFixtureProperties.d.ts')
	expect(requiredSharedOutputs).toContain('shared/js/testing/scalarOutcomeParityFixtures.js')
	expect(requiredSharedOutputs).toContain('shared/js/testing/scalarOutcomeParityFixtures.d.ts')
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
