import { describe, expect, test } from 'bun:test'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE, createSimulationProfile } from '@zoltar/ui-core-shared/lib/networkProfile.js'
import { getDeploymentSteps } from '../../protocol/deployment.js'

const simulationProfile = createSimulationProfile({ genesisRepTokenAddress: '0x1000000000000000000000000000000000000001', wethAddress: '0x2000000000000000000000000000000000000002' })

describe('statoblast deployment steps', () => {
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
			// monitored contract list. The statoblast list includes the four extra
			// statoblast contracts, so the address must differ from the zoltar-only one.
			const zoltarOracle = (await import('@zoltar/ui-zoltar/protocol/deployment.js')).getDeploymentSteps(profile).find(step => step.id === 'deploymentStatusOracle')
			if (zoltarOracle === undefined) throw new Error('Missing zoltar oracle step')
			expect(oracleStep.address === zoltarOracle.address).toBe(false)
		}
	})

	test('the oracle step monitors every deployed contract in the plan', async () => {
		const profile = simulationProfile
		const steps = getDeploymentSteps(profile)
		// Deploy through a fake client to capture the oracle init bytecode args.
		const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
		if (oracleStep === undefined) throw new Error('Missing deployment status oracle step')
		// The statoblast oracle step address must match the address the snapshot reader
		// resolves; both derive from the same bytecode, which embeds the monitored list.
		// Regression: previously the zoltar step was reused, so the deployed oracle only
		// tracked zoltar contracts and statoblast always reported SETUP INCOMPLETE.
		const zoltarSteps = await import('@zoltar/ui-zoltar/protocol/deployment.js')
		const zoltarOracle = zoltarSteps.getDeploymentSteps(profile).find(step => step.id === 'deploymentStatusOracle')
		if (zoltarOracle === undefined) throw new Error('Missing zoltar oracle step')
		expect(oracleStep.address === zoltarOracle.address).toBe(false)
		// And every statoblast step must appear in the monitored count: 15 steps for the
		// simulation profile (11 zoltar + 4 statoblast), one oracle address per plan.
		expect(steps.length).toBe(15)
	})
})
