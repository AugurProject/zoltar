import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { DeploymentStatusOracle_DeploymentStatusOracle } from '@zoltar/ui-core-shared/contractArtifact.js'
import { asWriteClient, createMockWriteClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import type { WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { getGenesisNetworkProfile, MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE, createSimulationProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { assertStaticStatoblastDeploymentArtifactRuntimeCodeHashes, getDeploymentSteps, getDeploymentStepConstructorArguments, loadDeploymentStatusOracleSnapshot } from '@zoltar/ui-statoblast-shared/protocol/deployment.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'

const simulationProfile = createSimulationProfile({ genesisOutcome: 'yes', genesisRepTokenAddress: '0x1000000000000000000000000000000000000001', wethAddress: '0x2000000000000000000000000000000000000002' })
const ORACLE_CREATION_CODE = `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.bytecode.object}` as const

// Captures the init code the oracle step submits to the proxy deployer instead of sending a transaction.
async function captureDeploymentInitCode(deploy: (client: WriteClient) => Promise<Hex>): Promise<Hex> {
	let initCode: Hex | undefined
	await deploy(
		asWriteClient(
			createMockWriteClient(request => {
				initCode = request.data
			}),
		),
	)
	if (initCode === undefined) throw new Error('The deployment step did not submit init code')
	return initCode
}

describe('statoblast deployment steps', () => {
	test('pins every directly deployed Statoblast artifact to its expected runtime code hash', () => {
		expect(assertStaticStatoblastDeploymentArtifactRuntimeCodeHashes()).toEqual(['escalationGameClaimDelegate', 'escalationGameDepositDelegate', 'openOracle', 'securityPoolEventEmitter', 'securityPoolOperationsDelegate', 'securityPoolUtils', 'uniformPriceDualCapBatchAuctionFactory'])
	})

	test('deploys recapitalization before its fork coordinator and preserves verification for every capital module', async () => {
		const publicProfiles = [MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE].flatMap(profile => (['yes', 'no'] as const).map(outcome => getGenesisNetworkProfile(profile, outcome)))
		for (const profile of [...publicProfiles, simulationProfile]) {
			const steps = getDeploymentSteps(profile)
			const recap = steps.find(step => step.id === 'securityPoolPortfolioRecapAuctionDeployer')
			const forks = steps.find(step => step.id === 'securityPoolPortfolioForkCoordinatorDeployer')
			if (recap === undefined || forks === undefined) throw new Error('Missing portfolio infrastructure deployment step')
			expect(forks.dependencies).toContain(recap.id)
			expect(steps.indexOf(recap)).toBeLessThan(steps.indexOf(forks))
			const constructor = encodeAbiParameters([{ type: 'address' }], [recap.address]).slice(2)
			expect((await captureDeploymentInitCode(forks.deploy)).endsWith(constructor)).toBe(true)
			expect(getDeploymentStepConstructorArguments(profile).securityPoolPortfolioForkCoordinatorDeployer).toBe(constructor)
			expect(getDeploymentStepConstructorArguments(profile).securityPoolPortfolioRecapAuctionDeployer).toBe('')
			for (const id of [
				'securityPoolCapitalLedgerDeployer',
				'securityPoolCommitmentIndexDeployer',
				'securityPoolCapitalFeeStreamsDeployer',
				'securityPoolSettlementBookDeployer',
				'securityPoolPortfolioSettlementDeployer',
				'securityPoolReporterLedgerDeployer',
				'securityPoolPortfolioRecapAuctionDeployer',
				'securityPoolPortfolioForkCoordinatorDeployer',
				'securityPoolForkerPortfolioDelegate',
			]) {
				expect(steps.find(step => step.id === id)?.expectedRuntimeCodeHash).toMatch(/^0x[0-9a-f]{64}$/)
			}
		}
	})

	test('deploys both shared escalation delegates before binding them to the factory', async () => {
		const steps = getDeploymentSteps(simulationProfile)
		const factory = steps.find(step => step.id === 'escalationGameFactory')
		const claim = steps.find(step => step.id === 'escalationGameClaimDelegate')
		const deposit = steps.find(step => step.id === 'escalationGameDepositDelegate')
		if (factory === undefined || claim === undefined || deposit === undefined) throw new Error('Missing escalation deployment step')
		expect(factory.dependencies).toEqual(['proxyDeployer', 'escalationGameClaimDelegate', 'escalationGameDepositDelegate'])
		expect(steps.indexOf(claim)).toBeLessThan(steps.indexOf(factory))
		expect(steps.indexOf(deposit)).toBeLessThan(steps.indexOf(factory))
		const initCode = await captureDeploymentInitCode(factory.deploy)
		expect(initCode.endsWith(encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [claim.address, deposit.address]).slice(2))).toBe(true)
	})

	test('the deployment status oracle step deploys the statoblast oracle, not the zoltar-only oracle', async () => {
		for (const profile of [MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE, simulationProfile]) {
			const steps = getDeploymentSteps(profile)
			const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
			if (oracleStep === undefined) throw new Error(`Missing deployment status oracle step for ${profile.id}`)
			const statoblastStepIds = [
				'securityPoolForker',
				'securityPoolForkerPortfolioDelegate',
				'escalationGameClaimDelegate',
				'escalationGameDepositDelegate',
				'escalationGameFactory',
				'securityPoolFactory',
				'securityPoolCapitalLedgerDeployer',
				'securityPoolCommitmentIndexDeployer',
				'securityPoolCapitalFeeStreamsDeployer',
				'securityPoolSettlementBookDeployer',
				'securityPoolPortfolioSettlementDeployer',
				'securityPoolReporterLedgerDeployer',
				'securityPoolPortfolioRecapAuctionDeployer',
				'securityPoolPortfolioForkCoordinatorDeployer',
			]
			for (const stepId of statoblastStepIds) {
				if (steps.every(step => step.id !== stepId)) throw new Error(`Missing statoblast deployment step ${stepId} for ${profile.id}`)
			}
			// The oracle address is derived from its init bytecode, which embeds the
			// monitored contract list. The statoblast list includes extra
			// statoblast contracts, so the address must differ from the zoltar-only one.
			const zoltarOracle = (await import('@zoltar/ui-zoltar-shared/protocol/deployment.js')).getDeploymentSteps(profile).find(step => step.id === 'deploymentStatusOracle')
			if (zoltarOracle === undefined) throw new Error('Missing zoltar oracle step')
			expect(oracleStep.address === zoltarOracle.address).toBe(false)
		}
	})

	test('the oracle constructor monitors every non-oracle deployment step in exact plan order', async () => {
		for (const profile of [MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE, simulationProfile]) {
			const steps = getDeploymentSteps(profile)
			const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
			if (oracleStep === undefined) throw new Error(`Missing deployment status oracle step for ${profile.id}`)
			const expectedMonitoredAddresses = steps.filter(step => step.id !== 'deploymentStatusOracle').map(step => step.address)

			const initCode = await captureDeploymentInitCode(oracleStep.deploy)
			expect(initCode.startsWith(ORACLE_CREATION_CODE)).toBe(true)
			expect(`0x${initCode.slice(ORACLE_CREATION_CODE.length)}`).toBe(encodeAbiParameters([{ type: 'address[]' }], [expectedMonitoredAddresses]))
		}
	})

	test('marks a step undeployed when the status oracle flags it but the chain has no code at its address', async () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: MAINNET_NETWORK_PROFILE }))
		try {
			const steps = getDeploymentSteps(MAINNET_NETWORK_PROFILE)
			const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
			if (oracleStep === undefined) throw new Error('Expected the deployment status oracle step')
			const oracleRuntimeCode: Hex = `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.deployedBytecode.object}`
			const allStepsMask = (1n << BigInt(steps.length - 1)) - 1n
			const snapshot = await loadDeploymentStatusOracleSnapshot({
				getCode: async ({ address }) => (address === oracleStep.address ? oracleRuntimeCode : '0x'),
				readContract: async ({ functionName }) => {
					if (functionName === 'getDeploymentMask') return allStepsMask as never
					throw new Error(`Unexpected read: ${functionName}`)
				},
			})
			expect(snapshot.deploymentStatuses.find(step => step.id === 'deploymentStatusOracle')?.deployed).toBe(true)
			expect(snapshot.deploymentStatuses.filter(step => step.id !== 'deploymentStatusOracle' && step.deployed).map(step => step.id)).toEqual([])
			expect(snapshot.applicationDeploymentComplete).toBe(false)
		} finally {
			resetEnvironment()
		}
	})
})
