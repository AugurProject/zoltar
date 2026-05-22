/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from 'viem'
import { formatCurrencyInputBalance } from '../lib/formatters.js'
import { parseOptionalRepAmountInput, parseRepAmountInput } from '../lib/marketForm.js'
import {
	doesLoadedSecurityVaultMatchSelection,
	getOracleManagerPriceValidUntilTimestamp,
	getSecurityVaultMaxBondAllowanceAmount,
	getSelectedVaultAddress,
	hasValidSecurityVaultOraclePrice,
	isSecurityVaultDepositBelowMinimum,
	isSelectedVaultOwnedByAccount,
	MIN_SECURITY_VAULT_REP_DEPOSIT,
	ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS,
} from '../lib/securityVault.js'
import { createConnectedReadClient } from '../lib/clients.js'
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

	void test('matches loaded vault details against the current effective pool and vault selection', () => {
		const accountAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000b1')
		const vaultAddress = getAddress('0x00000000000000000000000000000000000000c1')
		const details = {
			currentRetentionRate: 10n,
			lockedRepInEscalationGame: 0n,
			managerAddress: zeroAddress,
			poolOwnershipDenominator: 1n,
			repDepositShare: 1n,
			repToken: zeroAddress,
			securityBondAllowance: 0n,
			securityPoolAddress,
			totalSecurityBondAllowance: 0n,
			unpaidEthFees: 0n,
			universeId: 1n,
			vaultAddress,
		}

		expect(
			doesLoadedSecurityVaultMatchSelection({
				accountAddress,
				securityPoolAddress,
				securityVaultDetails: details,
				selectedVaultAddress: vaultAddress,
			}),
		).toBe(true)

		expect(
			doesLoadedSecurityVaultMatchSelection({
				accountAddress: vaultAddress,
				securityPoolAddress,
				securityVaultDetails: details,
				selectedVaultAddress: '',
			}),
		).toBe(true)

		expect(
			doesLoadedSecurityVaultMatchSelection({
				accountAddress,
				securityPoolAddress,
				securityVaultDetails: details,
				selectedVaultAddress: accountAddress,
			}),
		).toBe(false)

		expect(
			doesLoadedSecurityVaultMatchSelection({
				accountAddress,
				securityPoolAddress: zeroAddress,
				securityVaultDetails: details,
				selectedVaultAddress: vaultAddress,
			}),
		).toBe(false)

		expect(
			doesLoadedSecurityVaultMatchSelection({
				accountAddress,
				securityPoolAddress,
				securityVaultDetails: undefined,
				selectedVaultAddress: vaultAddress,
			}),
		).toBe(false)
	})

	void test('parses security vault REP inputs as 18-decimal token amounts', () => {
		expect(parseRepAmountInput('10', 'REP collateral amount')).toBe(MIN_SECURITY_VAULT_REP_DEPOSIT)
		expect(parseRepAmountInput('10.5', 'REP collateral amount')).toBe(105n * 10n ** 17n)
		expect(parseRepAmountInput('0.25', 'REP withdraw amount')).toBe(25n * 10n ** 16n)
		expect(parseOptionalRepAmountInput('1')).toBe(10n ** 18n)
		expect(parseOptionalRepAmountInput('1.5')).toBe(15n * 10n ** 17n)
		expect(parseOptionalRepAmountInput('abc')).toBe(undefined)
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

	void test('requires matching valid oracle manager details for queued vault actions', () => {
		const managerAddress = getAddress('0x00000000000000000000000000000000000000d1')
		const otherManagerAddress = getAddress('0x00000000000000000000000000000000000000d2')
		const validOracleManagerDetails = {
			isPriceValid: true,
			managerAddress,
		}

		expect(hasValidSecurityVaultOraclePrice(managerAddress, validOracleManagerDetails)).toBe(true)
		expect(hasValidSecurityVaultOraclePrice(managerAddress, { ...validOracleManagerDetails, isPriceValid: false })).toBe(false)
		expect(hasValidSecurityVaultOraclePrice(managerAddress, { ...validOracleManagerDetails, managerAddress: otherManagerAddress })).toBe(false)
		expect(hasValidSecurityVaultOraclePrice(undefined, validOracleManagerDetails)).toBe(false)
		expect(hasValidSecurityVaultOraclePrice(managerAddress, undefined)).toBe(false)
	})

	void test('derives the oracle price expiry timestamp from the last settlement time', () => {
		expect(getOracleManagerPriceValidUntilTimestamp(undefined)).toBe(undefined)
		expect(getOracleManagerPriceValidUntilTimestamp(0n)).toBe(undefined)
		expect(getOracleManagerPriceValidUntilTimestamp(15n)).toBe(15n + ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS)
	})

	void test('caps max security bond allowance by both vault backing and remaining pool backing', () => {
		expect(
			getSecurityVaultMaxBondAllowanceAmount({
				currentSecurityBondAllowance: 1n * 10n ** 18n,
				repDepositShare: 12n * 10n ** 18n,
				repPerEthPrice: 3n * 10n ** 18n,
				totalRepDeposit: 9n * 10n ** 18n,
				totalSecurityBondAllowance: 2n * 10n ** 18n,
			}),
		).toBe(1_999_999_999_999_999_999n)
		expect(
			getSecurityVaultMaxBondAllowanceAmount({
				currentSecurityBondAllowance: 0n,
				repDepositShare: 6n * 10n ** 18n,
				repPerEthPrice: 3n * 10n ** 18n,
			}),
		).toBe(1_999_999_999_999_999_999n)
	})

	void test('returns undefined for a missing security pool without reading contract state', async () => {
		let readContractCalled = false
		const client = createConnectedReadClient()
		const getCode: typeof client.getCode = async () => '0x'
		const readContract: typeof client.readContract = async () => {
			readContractCalled = true
			throw new Error('readContract should not be called for a missing security pool')
		}
		client.getCode = getCode
		client.readContract = readContract

		await expect(loadSecurityVaultDetails(client, getAddress('0x00000000000000000000000000000000000000b1'), getAddress('0x00000000000000000000000000000000000000c1'))).resolves.toBeUndefined()
		expect(readContractCalled).toBe(false)
	})
})
