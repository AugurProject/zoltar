/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { createLoadSecurityVaultHandler } from '../lib/securityVaultHandlers.js'

describe('App', () => {
	test('forwards vault refresh requests without requiring an explicit vault address', async () => {
		const calls: Array<string | undefined> = []
		const handleLoadSecurityVault = createLoadSecurityVaultHandler(async vaultAddress => {
			calls.push(vaultAddress)
		})

		handleLoadSecurityVault()
		handleLoadSecurityVault('0x123')

		expect(calls).toEqual([undefined, '0x123'])
	})
})
