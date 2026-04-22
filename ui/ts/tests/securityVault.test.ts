/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from 'viem'
import { formatCurrencyInputBalance } from '../lib/formatters.js'
import { parseRepAmountInput } from '../lib/marketForm.js'
import { getSelectedVaultAddress, isSecurityVaultDepositBelowMinimum, isSelectedVaultOwnedByAccount, MIN_SECURITY_VAULT_REP_DEPOSIT } from '../lib/securityVault.js'
import { loadSecurityVaultDetails } from '../contracts.js'

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

	void test('parses security vault REP inputs as 18-decimal token amounts', () => {
		expect(parseRepAmountInput('10', 'REP deposit amount')).toBe(MIN_SECURITY_VAULT_REP_DEPOSIT)
		expect(parseRepAmountInput('10.5', 'REP deposit amount')).toBe(105n * 10n ** 17n)
		expect(parseRepAmountInput('0.25', 'REP withdraw amount')).toBe(25n * 10n ** 16n)
	})

	void test('formats Max-style REP input amounts without grouped separators or raw base units', () => {
		expect(formatCurrencyInputBalance(MIN_SECURITY_VAULT_REP_DEPOSIT)).toBe('10')
		expect(formatCurrencyInputBalance(105n * 10n ** 17n)).toBe('10.5')
		expect(formatCurrencyInputBalance(1234567890000000000000n)).toBe('1234.56789')
	})

	void test('requires a minimum first deposit for brand-new vaults only', () => {
		expect(isSecurityVaultDepositBelowMinimum(0n, MIN_SECURITY_VAULT_REP_DEPOSIT - 1n)).toBe(true)
		expect(isSecurityVaultDepositBelowMinimum(undefined, MIN_SECURITY_VAULT_REP_DEPOSIT - 1n)).toBe(true)
		expect(isSecurityVaultDepositBelowMinimum(0n, MIN_SECURITY_VAULT_REP_DEPOSIT)).toBe(false)
		expect(isSecurityVaultDepositBelowMinimum(1n, 1n)).toBe(false)
		expect(isSecurityVaultDepositBelowMinimum(MIN_SECURITY_VAULT_REP_DEPOSIT, 5n * 10n ** 17n)).toBe(false)
	})

	void test('returns undefined for a missing security pool without reading contract state', async () => {
		let readContractCalled = false
		const client = {
			getCode: async () => '0x',
			readContract: async () => {
				readContractCalled = true
				throw new Error('readContract should not be called for a missing security pool')
			},
		} as unknown as Parameters<typeof loadSecurityVaultDetails>[0]

		await expect(loadSecurityVaultDetails(client, getAddress('0x00000000000000000000000000000000000000b1'), getAddress('0x00000000000000000000000000000000000000c1'))).resolves.toBeUndefined()
		expect(readContractCalled).toBe(false)
	})
})
