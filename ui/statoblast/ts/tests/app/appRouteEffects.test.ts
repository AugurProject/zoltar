/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { onchainStateDependencies } from '../../app/onchainStateDependencies.js'
import { getDeploymentSteps } from '@zoltar/ui-statoblast-shared/protocol/deployment.js'

describe('app route effects', () => {
	test('injects the complete Statoblast deployment plan into shared onchain state', () => {
		expect(onchainStateDependencies.getDeploymentSteps).toBe(getDeploymentSteps)
		expect(onchainStateDependencies.getDeploymentSteps(MAINNET_NETWORK_PROFILE).some(step => step.id === 'securityPoolFactory')).toBe(true)
	})
})
