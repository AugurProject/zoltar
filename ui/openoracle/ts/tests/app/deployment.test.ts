import { describe, expect, mock, test } from 'bun:test'
import { type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { PROXY_DEPLOYER_RUNTIME_CODE } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { statoblast_Multicall3_Multicall3 } from '@zoltar/ui-core-shared/contractArtifact.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE, createSimulationProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import type { DeploymentStepId } from '@zoltar/ui-core-shared/types/contracts.js'
import { statoblast_openOracle_OpenOracle_OpenOracle } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { getDeploymentSteps as getStatoblastDeploymentSteps } from '@zoltar/ui-statoblast-shared/protocol/deployment.js'
import { onchainStateDependencies } from '../../app/onchainStateDependencies.js'

const requiredIds = ['proxyDeployer', 'multicall3', 'openOracle']
const runtimeCodeById = new Map<DeploymentStepId, Hex>([
	['proxyDeployer', PROXY_DEPLOYER_RUNTIME_CODE],
	['multicall3', `0x${statoblast_Multicall3_Multicall3.evm.deployedBytecode.object}`],
	['openOracle', `0x${statoblast_openOracle_OpenOracle_OpenOracle.evm.deployedBytecode.object}`],
])
const simulationProfile = createSimulationProfile({ genesisOutcome: 'yes', genesisRepTokenAddress: '0x1000000000000000000000000000000000000001', wethAddress: '0x2000000000000000000000000000000000000002' })

function createClient(missingId?: DeploymentStepId) {
	const codes = new Map(getStatoblastDeploymentSteps(MAINNET_NETWORK_PROFILE).map(step => [step.address, step.id === missingId ? undefined : runtimeCodeById.get(step.id)]))
	const getCode = mock(async ({ address }: { address: Address }) => codes.get(address))
	const readContract = mock(async () => {
		throw new Error('OpenOracle setup must not read the Statoblast deployment oracle')
	})
	return { codes, getCode, readContract }
}

describe('OpenOracle deployment boundary', () => {
	test.each([MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE, simulationProfile])('requires only oracle contracts on $id', profile => {
		const steps = onchainStateDependencies.getDeploymentSteps(profile)
		expect(steps.map(step => step.id)).toEqual(requiredIds)
		for (const step of steps) {
			const canonical = getStatoblastDeploymentSteps(profile).find(candidate => candidate.id === step.id)
			expect(step.address).toBe(canonical?.address)
			expect(step.dependencies).toEqual(canonical?.dependencies)
			expect(step.expectedRuntimeCodeHash).toBe(canonical?.expectedRuntimeCodeHash)
			expect(step.trustedSimulationCodePresence).toBe(canonical?.trustedSimulationCodePresence)
			expect(step.dependencies.every(id => requiredIds.includes(id))).toBe(true)
		}
	})

	test('treats empty code as missing and propagates failed deployment reads', async () => {
		const restore = installActiveEnvironmentForTesting(createFakeBackend({ profile: MAINNET_NETWORK_PROFILE }))
		try {
			const client = createClient()
			for (const address of client.codes.keys()) client.codes.set(address, '0x')
			const snapshot = await onchainStateDependencies.loadDeploymentStatusOracleSnapshot(client)
			expect(snapshot.applicationDeploymentComplete).toBe(false)
			expect(snapshot.deploymentStatuses.every(step => !step.deployed)).toBe(true)
			await expect(
				onchainStateDependencies.loadDeploymentStatusOracleSnapshot({
					getCode: async () => {
						throw new Error('Read RPC unavailable')
					},
				}),
			).rejects.toThrow('Read RPC unavailable')
		} finally {
			restore()
		}
	})

	test('is ready with no pool, auction, Zoltar or deployment-status-oracle contracts installed', async () => {
		const restore = installActiveEnvironmentForTesting(createFakeBackend({ profile: MAINNET_NETWORK_PROFILE }))
		try {
			const client = createClient()
			const snapshot = await onchainStateDependencies.loadDeploymentStatusOracleSnapshot(client)
			expect(snapshot.applicationDeploymentComplete).toBe(true)
			expect(snapshot.deploymentStatuses.map(step => step.id)).toEqual(requiredIds)
			expect(snapshot.deploymentStatuses.every(step => step.deployed)).toBe(true)
			expect(client.getCode.mock.calls.map(([request]) => request.address).sort()).toEqual(
				onchainStateDependencies
					.getDeploymentSteps()
					.map(step => step.address)
					.sort(),
			)
			expect(client.readContract).not.toHaveBeenCalled()
		} finally {
			restore()
		}
	})

	test.each(['proxyDeployer', 'multicall3', 'openOracle'] satisfies DeploymentStepId[])('blocks readiness when $0 is missing', async missingId => {
		const restore = installActiveEnvironmentForTesting(createFakeBackend({ profile: MAINNET_NETWORK_PROFILE }))
		try {
			const snapshot = await onchainStateDependencies.loadDeploymentStatusOracleSnapshot(createClient(missingId))
			expect(snapshot.applicationDeploymentComplete).toBe(false)
			expect(snapshot.deploymentStatuses.filter(step => !step.deployed).map(step => step.id)).toEqual([missingId])
		} finally {
			restore()
		}
	})

	test.each(['proxyDeployer', 'multicall3', 'openOracle'] satisfies DeploymentStepId[])('rejects unexpected runtime code for $0', async id => {
		const restore = installActiveEnvironmentForTesting(createFakeBackend({ profile: MAINNET_NETWORK_PROFILE }))
		try {
			const client = createClient()
			const step = onchainStateDependencies.getDeploymentSteps().find(candidate => candidate.id === id)
			if (step === undefined) throw new Error(`Missing ${id} step`)
			client.codes.set(step.address, '0x00')
			await expect(onchainStateDependencies.loadDeploymentStatusOracleSnapshot(client)).rejects.toThrow(`Unexpected runtime code for ${id}`)
		} finally {
			restore()
		}
	})
})
