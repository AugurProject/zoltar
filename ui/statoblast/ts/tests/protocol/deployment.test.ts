import { describe, expect, test } from 'bun:test'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend, createFakeSimulationProfile } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { assertStaticStatoblastDeploymentArtifactRuntimeCodeHashes, EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES, getDeploymentSteps, loadDeploymentStatusSnapshot, STATIC_STATOBLAST_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID } from '../../protocol/deployment.js'

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
})
