/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { installActiveEnvironmentForTesting } from '../../lib/activeEnvironment.js'
import { SEPOLIA_NETWORK_PROFILE } from '../../lib/networkProfile.js'
import { getDeploymentSteps, getZoltarAddress } from '../../protocol/index.js'
import { createFakeBackend } from '../testUtils/fakeBackend.js'

describe('Sepolia deployment wiring', () => {
	test('uses Sepolia token addresses and derives Sepolia application addresses', () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: SEPOLIA_NETWORK_PROFILE }))
		try {
			const steps = getDeploymentSteps()
			expect(steps.find(step => step.id === 'weth')?.address).toBe(SEPOLIA_NETWORK_PROFILE.wethAddress)
			expect(steps.find(step => step.id === 'reputationToken')?.address).toBe(SEPOLIA_NETWORK_PROFILE.genesisRepTokenAddress)
			expect(steps.find(step => step.id === 'zoltar')?.address).toBe(getZoltarAddress())
		} finally {
			resetEnvironment()
		}
	})
})
