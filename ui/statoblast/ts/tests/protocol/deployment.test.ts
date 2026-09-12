import { describe, expect, test } from 'bun:test'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend, createFakeSimulationProfile } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { assertStaticStatoblastDeploymentArtifactRuntimeCodeHashes, getDeploymentSteps, loadDeploymentStatusSnapshot } from '@zoltar/ui-statoblast-shared/protocol/deployment.js'

describe('statoblast deployment steps', () => {
	test('simulation deployment status distinguishes empty, partial, and complete code', async () => {
		const restore = installActiveEnvironmentForTesting(createFakeBackend({ profile: createFakeSimulationProfile() }))
		try {
			const steps = getDeploymentSteps()
			const deployed = new Set<string>()
			const client = { getCode: async ({ address }: { address: string }) => (deployed.has(address) ? ('0x01' as const) : undefined) }
			const empty = await loadDeploymentStatusSnapshot(client)
			expect(empty.applicationDeploymentComplete).toBe(false)
			expect(empty.deploymentStatuses.every(step => !step.deployed)).toBe(true)

			const first = steps[0]
			if (first === undefined) throw new Error('Expected at least one deployment step')
			deployed.add(first.address)
			const partial = await loadDeploymentStatusSnapshot(client)
			expect(partial.applicationDeploymentComplete).toBe(false)
			expect(partial.deploymentStatuses.filter(step => step.deployed).map(step => step.id)).toEqual([first.id])

			for (const step of steps) deployed.add(step.address)
			const complete = await loadDeploymentStatusSnapshot(client)
			expect(complete.applicationDeploymentComplete).toBe(true)
			expect(complete.deploymentStatuses.every(step => step.deployed)).toBe(true)
		} finally {
			restore()
		}
	})

	test('pins every directly deployed Statoblast artifact to its expected runtime code hash', () => {
		expect(assertStaticStatoblastDeploymentArtifactRuntimeCodeHashes()).toEqual(['escalationGameClaimDelegate', 'openOracle', 'securityPoolOperationsDelegate', 'securityPoolUtils', 'uniformPriceDualCapBatchAuctionFactory'])
	})

	test('public deployment plans do not require a status oracle', () => {
		for (const profile of [MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE]) {
			expect(getDeploymentSteps(profile).map(step => step.id)).not.toContain('deploymentStatusOracle')
		}
	})
})
