import { describe, expect, test } from 'bun:test'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE, createSimulationProfile } from '@zoltar/ui-core-shared/lib/networkProfile.js'
import { assertStaticStatoblastDeploymentArtifactRuntimeCodeHashes, EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES, getDeploymentSteps, getStatoblastDeploymentStatusOracleStepAddresses, STATIC_STATOBLAST_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID } from '../../protocol/deployment.js'

const simulationProfile = createSimulationProfile({ genesisRepTokenAddress: '0x1000000000000000000000000000000000000001', wethAddress: '0x2000000000000000000000000000000000000002' })

describe('statoblast deployment steps', () => {
	test('pins every directly deployed Statoblast artifact to its expected runtime code hash', () => {
		expect(Object.keys(STATIC_STATOBLAST_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID).sort()).toEqual(['escalationGameClaimDelegate', 'openOracle', 'securityPoolOperationsDelegate', 'securityPoolUtils', 'uniformPriceDualCapBatchAuctionFactory'])
		expect(() => assertStaticStatoblastDeploymentArtifactRuntimeCodeHashes()).not.toThrow()
		for (const stepId of Object.keys(STATIC_STATOBLAST_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID)) {
			expect(() =>
				assertStaticStatoblastDeploymentArtifactRuntimeCodeHashes({
					expectedRuntimeCodeHashes: EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES,
					runtimeCodeByStepId: {
						...STATIC_STATOBLAST_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID,
						[stepId]: '0x01',
					},
				}),
			).toThrow(`Local runtime code for ${stepId}`)
		}
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
			// monitored contract list. The statoblast list includes the nine extra
			// statoblast contracts, so the address must differ from the zoltar-only one.
			const zoltarOracle = (await import('@zoltar/ui-zoltar/protocol/deployment.js')).getDeploymentSteps(profile).find(step => step.id === 'deploymentStatusOracle')
			if (zoltarOracle === undefined) throw new Error('Missing zoltar oracle step')
			expect(oracleStep.address === zoltarOracle.address).toBe(false)
		}
	})

	test('the oracle constructor monitors every non-oracle deployment step in exact plan order', () => {
		for (const profile of [MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE, simulationProfile]) {
			const steps = getDeploymentSteps(profile)
			const expectedMonitoredAddresses = steps.filter(step => step.id !== 'deploymentStatusOracle').map(step => step.address)

			expect(getStatoblastDeploymentStatusOracleStepAddresses(profile)).toEqual(expectedMonitoredAddresses)
		}
	})
})
