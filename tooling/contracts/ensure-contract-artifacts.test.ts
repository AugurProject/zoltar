import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { pathExists } from '../repo/fs.mts'
import { projectDependencyClosure } from '../repo/projects.ts'
import { getContractFreshnessInputRelativePaths, getRequiredContractArtifactRelativePaths, getRequiredSharedOutputRelativePaths, removeUnexpectedSharedSourceOutputs } from './ensure-contract-artifacts.mts'

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

		expect(await pathExists(path.join(sharedSourceRoot, 'oracleInitialReport.ts'))).toBe(true)
		expect(await pathExists(path.join(sharedSourceRoot, 'oracleInitialReport.js'))).toBe(false)
		expect(await pathExists(path.join(sharedSourceRoot, 'oracleInitialReport.js.map'))).toBe(false)
		expect(await pathExists(path.join(sharedSourceRoot, 'nested/generated.d.ts'))).toBe(false)
		expect(await pathExists(path.join(sharedSourceRoot, 'nested/generated.d.ts.map'))).toBe(false)
		expect(await pathExists(path.join(sharedSourceRoot, 'nested/standalone.d.ts'))).toBe(true)
	} finally {
		await rm(repositoryRoot, { force: true, recursive: true })
	}
})

test('local contract freshness tracks every CI contract-cache producer input the local compile consumes', () => {
	const localInputs = getContractFreshnessInputRelativePaths()
	expect(localInputs).toContain('solidity/ts/contractProjects.ts')
	const ciContractInputs = projectDependencyClosure(['contracts']).flatMap(project => project.tasks.build?.cacheInputs ?? project.tasks.build?.inputs ?? [])
	// Plain files under solidity/ts plus the UI artifact producer are inputs to the local compile:current chain.
	const consumedPlainFiles = ciContractInputs.filter(input => !/[*?[\]{}]/u.test(input) && (input.startsWith('solidity/ts/') || input === 'tooling/ui/projectArtifacts.mts'))
	for (const input of consumedPlainFiles) expect(localInputs).toContain(input)
})
