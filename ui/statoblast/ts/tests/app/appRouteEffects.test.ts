/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { onchainStateDependencies } from '../../app/onchainStateDependencies.js'
import { getStatoblastUiDeploymentSteps } from '@zoltar/ui-statoblast-shared/protocol/deployment.js'

describe('app route effects', () => {
	test('injects the complete Statoblast deployment plan into shared onchain state', () => {
		expect(onchainStateDependencies.getDeploymentSteps).toBe(getStatoblastUiDeploymentSteps)
		const steps = onchainStateDependencies.getDeploymentSteps(MAINNET_NETWORK_PROFILE)
		expect(steps.some(step => step.id === 'securityPoolFactory')).toBe(true)
		expect(steps.every(step => step.verificationLabel === step.label)).toBe(true)
	})
})
