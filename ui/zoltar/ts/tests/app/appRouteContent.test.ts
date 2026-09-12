/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { shouldRenderAppRouteContent } from '@zoltar/ui-core-shared/app/lib/appRouteGate.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { onchainStateDependencies } from '../../app/onchainStateDependencies.js'
import { getDeploymentSteps } from '@zoltar/ui-zoltar-shared/protocol/deployment.js'
import { isUniverseIndependentZoltarView } from '@zoltar/ui-zoltar-shared/lib/routing.js'

describe('AppRouteContent', () => {
	test('keeps only global question views available without a universe', () => {
		expect(isUniverseIndependentZoltarView('questions')).toBe(true)
		expect(isUniverseIndependentZoltarView('create')).toBe(true)
		expect(isUniverseIndependentZoltarView('fork')).toBe(false)
		expect(isUniverseIndependentZoltarView('migrate')).toBe(false)
	})

	test('injects the Zoltar-specific deployment plan into shared onchain state', () => {
		expect(onchainStateDependencies.getDeploymentSteps).toBe(getDeploymentSteps)
		expect(onchainStateDependencies.getDeploymentSteps(MAINNET_NETWORK_PROFILE).some(step => step.id === 'securityPoolFactory')).toBe(false)
	})

	test('keeps route content visible when the read backend is ready', () => {
		expect(shouldRenderAppRouteContent('zoltar', undefined)).toBe(true)
	})

	test('does not render route content when the configured read RPC is on the wrong chain', () => {
		expect(shouldRenderAppRouteContent('zoltar', 'Configured read RPC reports chain 11155111, but this app requires Ethereum Mainnet (1).')).toBe(false)
	})

	test('renders route content when both wallet and read backend are ready', () => {
		expect(shouldRenderAppRouteContent('zoltar', undefined)).toBe(true)
	})

	test('keeps deploy route content available when the configured read RPC is on the wrong chain', () => {
		expect(shouldRenderAppRouteContent('deploy', 'Configured read RPC reports chain 11155111, but this app requires Ethereum Mainnet (1).')).toBe(true)
	})
})
