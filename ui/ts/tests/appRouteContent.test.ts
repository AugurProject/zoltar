/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { shouldRenderRouteContent } from '../components/AppRouteContent.js'

describe('AppRouteContent', () => {
	test('does not render route content when the connected wallet is on the wrong network', () => {
		expect(shouldRenderRouteContent({ readBackendMessage: undefined, route: 'zoltar', wrongNetworkMessage: 'Switch to Ethereum mainnet.' })).toBe(false)
	})

	test('does not render route content when the configured read RPC is on the wrong chain', () => {
		expect(shouldRenderRouteContent({ readBackendMessage: 'Configured read RPC reports chain 11155111, but this app requires Ethereum Mainnet (1).', route: 'zoltar', wrongNetworkMessage: undefined })).toBe(false)
	})

	test('renders route content when both wallet and read backend are ready', () => {
		expect(shouldRenderRouteContent({ readBackendMessage: undefined, route: 'zoltar', wrongNetworkMessage: undefined })).toBe(true)
	})

	test('keeps deploy route content available when the configured read RPC is on the wrong chain', () => {
		expect(shouldRenderRouteContent({ readBackendMessage: 'Configured read RPC reports chain 11155111, but this app requires Ethereum Mainnet (1).', route: 'deploy', wrongNetworkMessage: undefined })).toBe(true)
	})
})
