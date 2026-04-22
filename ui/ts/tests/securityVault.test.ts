/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from 'viem'
import { formatSecurityVaultRepInputAmount, getSelectedVaultAddress, isSecurityVaultDepositBelowMinimum, isSelectedVaultOwnedByAccount, MIN_SECURITY_VAULT_REP_DEPOSIT, parseSecurityVaultRepInputAmount } from '../lib/securityVault.js'

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
		expect(parseSecurityVaultRepInputAmount('10', 'REP deposit amount')).toBe(10n * 10n ** 18n)
		expect(parseSecurityVaultRepInputAmount('10.5', 'REP deposit amount')).toBe(105n * 10n ** 17n)
		expect(parseSecurityVaultRepInputAmount('0.25', 'REP withdraw amount')).toBe(25n * 10n ** 16n)
	})

	void test('formats Max-style REP input amounts without grouped separators or raw base units', () => {
		expect(formatSecurityVaultRepInputAmount(10n * 10n ** 18n)).toBe('10')
		expect(formatSecurityVaultRepInputAmount(105n * 10n ** 17n)).toBe('10.5')
		expect(formatSecurityVaultRepInputAmount(1234567890000000000000n)).toBe('1234.56789')
	})

	void test('requires a minimum first deposit for brand-new vaults only', () => {
		expect(isSecurityVaultDepositBelowMinimum(0n, MIN_SECURITY_VAULT_REP_DEPOSIT - 1n)).toBe(true)
		expect(isSecurityVaultDepositBelowMinimum(undefined, MIN_SECURITY_VAULT_REP_DEPOSIT - 1n)).toBe(true)
		expect(isSecurityVaultDepositBelowMinimum(0n, MIN_SECURITY_VAULT_REP_DEPOSIT)).toBe(false)
		expect(isSecurityVaultDepositBelowMinimum(1n, 1n)).toBe(false)
		expect(isSecurityVaultDepositBelowMinimum(10n * 10n ** 18n, 5n * 10n ** 17n)).toBe(false)
	})
})
