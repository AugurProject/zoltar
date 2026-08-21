/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { shouldRenderRouteContent } from '../../app/components/AppRouteContent.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/lib/networkProfile.js'
import { onchainStateDependencies } from '../../app/onchainStateDependencies.js'
import { getDeploymentSteps } from '../../protocol/deployment.js'

describe('AppRouteContent', () => {
	test('injects the Zoltar-specific deployment plan into shared onchain state', () => {
		expect(onchainStateDependencies.getDeploymentSteps).toBe(getDeploymentSteps)
		expect(onchainStateDependencies.getDeploymentSteps(MAINNET_NETWORK_PROFILE).some(step => step.id === 'securityPoolFactory')).toBe(false)
	})

	test('keeps route content visible when the read backend is ready', () => {
		expect(shouldRenderRouteContent({ readBackendMessage: undefined, route: 'zoltar' })).toBe(true)
		expect(shouldRenderRouteContent({ readBackendMessage: undefined, route: 'security-pools' })).toBe(true)
		expect(shouldRenderRouteContent({ readBackendMessage: undefined, route: 'open-oracle' })).toBe(true)
	})

	test('does not render route content when the configured read RPC is on the wrong chain', () => {
		expect(shouldRenderRouteContent({ readBackendMessage: 'Configured read RPC reports chain 11155111, but this app requires Ethereum Mainnet (1).', route: 'zoltar' })).toBe(false)
	})

	test('renders route content when both wallet and read backend are ready', () => {
		expect(shouldRenderRouteContent({ readBackendMessage: undefined, route: 'zoltar' })).toBe(true)
	})

	test('keeps deploy route content available when the configured read RPC is on the wrong chain', () => {
		expect(shouldRenderRouteContent({ readBackendMessage: 'Configured read RPC reports chain 11155111, but this app requires Ethereum Mainnet (1).', route: 'deploy' })).toBe(true)
	})
})
