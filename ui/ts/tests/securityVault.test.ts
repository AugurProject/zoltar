/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from 'viem'
import { canManageSelectedVault, getSelectedVaultAddress, isSelectedVaultOwnedByAccount } from '../lib/securityVault.js'

void describe('security vault helpers', () => {
	void test('defaults to the connected wallet vault when no explicit vault is selected', () => {
		const accountAddress = getAddress('0x00000000000000000000000000000000000000a1')
		expect(getSelectedVaultAddress('', accountAddress)).toBe(accountAddress)
		expect(getSelectedVaultAddress('   ', accountAddress)).toBe(accountAddress)
		expect(getSelectedVaultAddress(undefined, accountAddress)).toBe(accountAddress)
		expect(getSelectedVaultAddress(undefined, undefined)).toBe(undefined)
	})

	void test('detects whether the selected vault is owned by the connected wallet', () => {
		const accountAddress = getAddress('0x00000000000000000000000000000000000000a1')
		expect(isSelectedVaultOwnedByAccount(accountAddress, accountAddress)).toBe(true)
		expect(isSelectedVaultOwnedByAccount(accountAddress.toUpperCase(), accountAddress)).toBe(true)
		expect(isSelectedVaultOwnedByAccount(getAddress('0x00000000000000000000000000000000000000a2'), accountAddress)).toBe(false)
		expect(isSelectedVaultOwnedByAccount('', accountAddress)).toBe(false)
		expect(isSelectedVaultOwnedByAccount(undefined, zeroAddress)).toBe(false)
	})

	void test('only allows management controls for the connected wallet vault', () => {
		const accountAddress = getAddress('0x00000000000000000000000000000000000000a1')
		expect(canManageSelectedVault(accountAddress, accountAddress)).toBe(true)
		expect(canManageSelectedVault(getAddress('0x00000000000000000000000000000000000000a2'), accountAddress)).toBe(false)
		expect(canManageSelectedVault(undefined, accountAddress)).toBe(false)
	})
})
