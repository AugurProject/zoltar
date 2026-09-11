import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { DeploymentStatusOracle_DeploymentStatusOracle } from '@zoltar/ui-core-shared/contractArtifact.js'
import { asWriteClient, createMockWriteClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import type { WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE, createSimulationProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { assertStaticStatoblastDeploymentArtifactRuntimeCodeHashes, getDeploymentSteps } from '@zoltar/ui-statoblast-shared/protocol/deployment.js'

const simulationProfile = createSimulationProfile({ genesisRepTokenAddress: '0x1000000000000000000000000000000000000001', wethAddress: '0x2000000000000000000000000000000000000002' })
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
		expect(() => assertStaticStatoblastDeploymentArtifactRuntimeCodeHashes()).not.toThrow()
	})

	test('the deployment status oracle step deploys the statoblast oracle, not the zoltar-only oracle', async () => {
		for (const profile of [MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE, simulationProfile]) {
			const steps = getDeploymentSteps(profile)
			const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
			if (oracleStep === undefined) throw new Error(`Missing deployment status oracle step for ${profile.id}`)
			const statoblastStepIds = ['securityPoolForker', 'escalationGameClaimDelegate', 'escalationGameFactory', 'securityPoolFactory']
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
})
