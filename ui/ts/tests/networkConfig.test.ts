/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { resolveConfiguredNetworkProfile } from '../lib/networkConfig.js'

describe('network configuration', () => {
	test('uses mainnet by default', () => {
		expect(resolveConfiguredNetworkProfile({ location: { search: '' }, storage: { getItem: () => null } }).id).toBe('mainnet')
	})

	test('selects Sepolia from the top-level or hash query string', () => {
		expect(resolveConfiguredNetworkProfile({ location: { search: '?network=sepolia' }, storage: { getItem: () => null } }).id).toBe('sepolia')
		expect(resolveConfiguredNetworkProfile({ location: { hash: '#/deploy?network=sepolia' }, storage: { getItem: () => null } }).id).toBe('sepolia')
	})

	test('selects Sepolia from persisted configuration', () => {
		expect(resolveConfiguredNetworkProfile({ location: { search: '' }, storage: { getItem: key => (key === 'zoltar.network' ? 'sepolia' : null) } }).id).toBe('sepolia')
	})
})
