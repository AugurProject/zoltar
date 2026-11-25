import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { DeploymentStatusOracle_DeploymentStatusOracle, ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import { asWriteClient, createMockWriteClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { PROXY_DEPLOYER_RUNTIME_CODE } from '@zoltar/core-shared/deployment/deploymentAddresses'
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
		expect(assertStaticStatoblastDeploymentArtifactRuntimeCodeHashes()).toEqual(['escalationGameDepositDelegate', 'openOracle', 'questionLedgerEventEmitter', 'questionLedgerOperationsDelegate'])
	})

	test('deploys independent fork and auction modules with verified runtime code', async () => {
		const publicProfiles = [MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE].flatMap(profile => (['yes', 'no'] as const).map(outcome => getGenesisNetworkProfile(profile, outcome)))
		for (const profile of [...publicProfiles, simulationProfile]) {
			const steps = getDeploymentSteps(profile)
			for (const id of ['securityPoolForkCoordinatorDeployer', 'securityPoolRepairAuctionDeployer'] as const) {
				const module = steps.find(step => step.id === id)
				if (module === undefined) throw new Error('Missing security pool infrastructure deployment step')
				expect(module.dependencies).toEqual(['proxyDeployer'])
				expect(await captureDeploymentInitCode(module.deploy)).toMatch(/^0x[0-9a-f]+$/)
				expect(getDeploymentStepConstructorArguments(profile)[id]).toBe('')
			}
			for (const id of [
				'securityPoolCapitalLedgerDeployer',
				'securityPoolCommitmentIndexDeployer',
				'securityPoolCapitalFeeStreamsDeployer',
				'securityPoolSettlementBookDeployer',
				'securityPoolSettlementDeployer',
				'securityPoolServicesDeployer',
				'securityPoolReporterLedgerDeployer',
				'securityPoolForkCoordinatorDeployer',
				'securityPoolRepairAuctionDeployer',
			]) {
				expect(steps.find(step => step.id === id)?.expectedRuntimeCodeHash).toMatch(/^0x[0-9a-f]{64}$/)
			}
		}
	})

	test('deploys the shared deposit delegate before binding it to the factory', async () => {
		const steps = getDeploymentSteps(simulationProfile)
		const factory = steps.find(step => step.id === 'escalationGameFactory')
		const deposit = steps.find(step => step.id === 'escalationGameDepositDelegate')
		if (factory === undefined || deposit === undefined) throw new Error('Missing escalation deployment step')
		expect(factory.dependencies).toEqual(['proxyDeployer', 'escalationGameDepositDelegate'])
		expect(steps.indexOf(deposit)).toBeLessThan(steps.indexOf(factory))
		const initCode = await captureDeploymentInitCode(factory.deploy)
		expect(initCode.endsWith(encodeAbiParameters([{ type: 'address' }], [deposit.address]).slice(2))).toBe(true)
	})

	test('the deployment status oracle step deploys the statoblast oracle, not the zoltar-only oracle', async () => {
		for (const profile of [MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE, simulationProfile]) {
			const steps = getDeploymentSteps(profile)
			const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
			if (oracleStep === undefined) throw new Error(`Missing deployment status oracle step for ${profile.id}`)
			const statoblastStepIds = [
				'questionForker',
				'escalationGameDepositDelegate',
				'escalationGameFactory',
				'securityPoolFactory',
				'securityPoolCapitalLedgerDeployer',
				'securityPoolCommitmentIndexDeployer',
				'securityPoolCapitalFeeStreamsDeployer',
				'securityPoolSettlementBookDeployer',
				'securityPoolSettlementDeployer',
				'securityPoolServicesDeployer',
				'securityPoolReporterLedgerDeployer',
				'securityPoolForkCoordinatorDeployer',
				'securityPoolRepairAuctionDeployer',
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

	test('reports shared steps already installed by the other genesis root before this root has a status oracle', async () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: MAINNET_NETWORK_PROFILE }))
		try {
			const steps = getDeploymentSteps(MAINNET_NETWORK_PROFILE)
			const proxyStep = steps.find(step => step.id === 'proxyDeployer')
			const questionDataStep = steps.find(step => step.id === 'zoltarQuestionData')
			if (proxyStep === undefined || questionDataStep === undefined) throw new Error('Expected proxy and question data deployment steps')
			const questionDataRuntimeCode: Hex = `0x${ZoltarQuestionData_ZoltarQuestionData.evm.deployedBytecode.object}`
			const snapshot = await loadDeploymentStatusOracleSnapshot({
				getCode: async ({ address }) => {
					if (address === proxyStep.address) return PROXY_DEPLOYER_RUNTIME_CODE
					if (address === questionDataStep.address) return questionDataRuntimeCode
					return '0x'
				},
				readContract: async ({ functionName }) => {
					throw new Error(`Unexpected read without a status oracle: ${functionName}`)
				},
			})
			expect(snapshot.deploymentStatuses.filter(step => step.deployed).map(step => step.id)).toEqual(['proxyDeployer', 'zoltarQuestionData'])
			expect(snapshot.applicationDeploymentComplete).toBe(false)
		} finally {
			resetEnvironment()
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
