/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { parseOptionalRepAmountInput, parseRepAmountInput } from '../../../features/markets/lib/marketForm.js'
import {
	doesLoadedSecurityVaultMatchSelection,
	doesSecurityVaultExistOnchain,
	getOracleManagerPriceValidUntilTimestamp,
	getSecurityVaultMaxCapacityOwnershipAttoRepAmount,
	getSecurityVaultWithdrawableRepAmount,
	getSelectedVaultOwner,
	hasValidSecurityVaultOraclePrice,
	isOracleManagerPriceUsable,
	isSecurityVaultDepositBelowMinimum,
	isSelectedVaultOwnedByAccount,
	MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP,
	ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS,
} from '../../../features/security-pools/lib/securityVault.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/lib/clients.js'
import { loadSecurityVaultDetails } from '@zoltar/ui-zoltar/protocol/index.js'

void describe('security vault helpers', () => {
	void test('defaults to the connected wallet vault when no explicit vault is selected', () => {
		const accountAddress = getAddress('0x00000000000000000000000000000000000000a1')
		expect(getSelectedVaultOwner('', accountAddress)).toBe(accountAddress)
		expect(getSelectedVaultOwner('   ', accountAddress)).toBe(accountAddress)
		expect(getSelectedVaultOwner(undefined, accountAddress)).toBe(accountAddress)
		expect(getSelectedVaultOwner(undefined, undefined)).toBe(undefined)
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
			badDebtAttoEth: 0n,
			currentRetentionRate: 10n,
			disputeStakedAttoRep: 0n,
			managerAddress: zeroAddress,
			totalRepBackingUnits: 1n,
			vaultAttoRepBacking: 1n,
			repToken: zeroAddress,
			capacityOwnershipAttoRep: 0n,
			securityPoolAddress,
			totalCapacityOwnershipAttoRep: 0n,
			claimableFeesAttoEth: 0n,
			universeId: 1n,
			vaultAddress,
		}

		expect(
			doesLoadedSecurityVaultMatchSelection({
				accountAddress,
				securityPoolAddress,
				securityVaultDetails: details,
				selectedVaultOwner: vaultAddress,
			}),
		).toBe(true)

		expect(
			doesLoadedSecurityVaultMatchSelection({
				accountAddress: vaultAddress,
				securityPoolAddress,
				securityVaultDetails: details,
				selectedVaultOwner: '',
			}),
		).toBe(true)

		expect(
			doesLoadedSecurityVaultMatchSelection({
				accountAddress,
				securityPoolAddress,
				securityVaultDetails: details,
				selectedVaultOwner: accountAddress,
			}),
		).toBe(false)

		expect(
			doesLoadedSecurityVaultMatchSelection({
				accountAddress,
				securityPoolAddress: zeroAddress,
				securityVaultDetails: details,
				selectedVaultOwner: vaultAddress,
			}),
		).toBe(false)

		expect(
			doesLoadedSecurityVaultMatchSelection({
				accountAddress,
				securityPoolAddress,
				securityVaultDetails: undefined,
				selectedVaultOwner: vaultAddress,
			}),
		).toBe(false)
	})

	void test('treats bad-debt-only vault details as an existing onchain vault', () => {
		const details = {
			badDebtAttoEth: 1n,
			currentRetentionRate: 0n,
			disputeStakedAttoRep: 0n,
			managerAddress: zeroAddress,
			totalRepBackingUnits: 0n,
			vaultAttoRepBacking: 0n,
			repToken: zeroAddress,
			capacityOwnershipAttoRep: 0n,
			securityPoolAddress: zeroAddress,
			totalCapacityOwnershipAttoRep: 0n,
			claimableFeesAttoEth: 0n,
			universeId: 0n,
			vaultAddress: zeroAddress,
		}

		expect(doesSecurityVaultExistOnchain(details)).toBe(true)
	})

	void test('parses security vault REP inputs as 18-decimal token amounts', () => {
		expect(parseRepAmountInput('10', 'REP backing amount')).toBe(MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP)
		expect(parseRepAmountInput('10.5', 'REP backing amount')).toBe(105n * 10n ** 17n)
		expect(parseRepAmountInput('0.25', 'REP withdraw amount')).toBe(25n * 10n ** 16n)
		expect(parseOptionalRepAmountInput('1')).toBe(10n ** 18n)
		expect(parseOptionalRepAmountInput('1.5')).toBe(15n * 10n ** 17n)
		expect(parseOptionalRepAmountInput('abc')).toBe(undefined)
	})

	void test('formats Max-style REP input amounts without grouped separators or raw base units', () => {
		expect(formatCurrencyInputBalance(MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP)).toBe('10')
		expect(formatCurrencyInputBalance(105n * 10n ** 17n)).toBe('10.5')
		expect(formatCurrencyInputBalance(1234567890000000000000n)).toBe('1234.56789')
	})

	void test('requires a minimum first deposit for brand-new vaults only', () => {
		expect(isSecurityVaultDepositBelowMinimum(0n, MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP - 1n)).toBe(true)
		expect(isSecurityVaultDepositBelowMinimum(undefined, MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP - 1n)).toBe(true)
		expect(isSecurityVaultDepositBelowMinimum(0n, MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP)).toBe(false)
		expect(isSecurityVaultDepositBelowMinimum(1n, 1n)).toBe(false)
		expect(isSecurityVaultDepositBelowMinimum(MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP, 5n * 10n ** 17n)).toBe(false)
		expect(isSecurityVaultDepositBelowMinimum(0n, 19n * 10n ** 18n, 20n * 10n ** 18n)).toBe(true)
		expect(isSecurityVaultDepositBelowMinimum(0n, 20n * 10n ** 18n, 20n * 10n ** 18n)).toBe(false)
	})

	void test('requires matching valid oracle manager details for queued vault actions', () => {
		const managerAddress = getAddress('0x00000000000000000000000000000000000000d1')
		const otherManagerAddress = getAddress('0x00000000000000000000000000000000000000d2')
		const validOracleManagerDetails = {
			isPriceValid: true,
			lastSettlementTimestamp: 100n,
			managerAddress,
			priceValidUntilTimestamp: 400n,
		}

		expect(hasValidSecurityVaultOraclePrice(managerAddress, validOracleManagerDetails, 399n)).toBe(true)
		expect(hasValidSecurityVaultOraclePrice(managerAddress, validOracleManagerDetails, 400n)).toBe(false)
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

	void test('treats a loaded oracle validity flag as expired at the shared time boundary', () => {
		const details = {
			isPriceValid: true,
			lastSettlementTimestamp: 100n,
			priceValidUntilTimestamp: 400n,
		}
		expect(isOracleManagerPriceUsable(details)).toBe(true)
		expect(isOracleManagerPriceUsable(details, 399n)).toBe(true)
		expect(isOracleManagerPriceUsable(details, 400n)).toBe(false)
		expect(isOracleManagerPriceUsable({ ...details, isPriceValid: false }, 399n)).toBe(false)
	})

	void test('caps max capacity ownership by both vault backing and remaining pool backing', () => {
		expect(
			getSecurityVaultMaxCapacityOwnershipAttoRepAmount({
				currentCapacityOwnershipAttoRep: 1n * 10n ** 18n,
				vaultAttoRepBacking: 12n * 10n ** 18n,
				repPerEthPrice: 3n * 10n ** 18n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: 9n * 10n ** 18n,
				totalCapacityOwnershipAttoRep: 2n * 10n ** 18n,
			}),
		).toBe(500_000_000_000_000_000n)
		expect(
			getSecurityVaultMaxCapacityOwnershipAttoRepAmount({
				currentCapacityOwnershipAttoRep: 0n,
				vaultAttoRepBacking: 6n * 10n ** 18n,
				repPerEthPrice: 3n * 10n ** 18n,
				statoblastSecurityMultiplierBps: 20_000n,
			}),
		).toBe(1n * 10n ** 18n)
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

	void test('returns zero or no withdrawal when balance inputs are missing or blocked', () => {
		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: undefined,
				repPerEthPrice: 0n,
				capacityOwnershipAttoRep: 0n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: undefined,
				totalCapacityOwnershipAttoRep: undefined,
			}),
		).toBe(undefined)
		expect(
			getSecurityVaultWithdrawableRepAmount({
				disputeStakedAttoRep: 1n,
				vaultAttoRepBacking: 10n * 10n ** 18n,
				repPerEthPrice: 0n,
				capacityOwnershipAttoRep: 0n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: undefined,
				totalCapacityOwnershipAttoRep: undefined,
			}),
		).toBe(0n)
		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: 10n * 10n ** 18n,
				repPerEthPrice: 0n,
				capacityOwnershipAttoRep: 0n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: undefined,
				totalCapacityOwnershipAttoRep: undefined,
			}),
		).toBe(10n * 10n ** 18n)
	})

	void test('caps max capacity ownership by local backing and empty global context', () => {
		expect(
			getSecurityVaultMaxCapacityOwnershipAttoRepAmount({
				vaultAttoRepBacking: 20n * 10n ** 18n,
				repPerEthPrice: 2n * 10n ** 18n,
				currentCapacityOwnershipAttoRep: 10n * 10n ** 18n,
				statoblastSecurityMultiplierBps: 20_000n,
			}),
		).toBe(5n * 10n ** 18n)
	})

	void test('capacity ownership', () => {
		const vaultAttoRepBacking = 10n * 10n ** 18n
		const repPerEthPrice = 3n * 10n ** 18n
		const statoblastSecurityMultiplierBps = 20_000n
		const maxCapacityOwnershipAttoRep = getSecurityVaultMaxCapacityOwnershipAttoRepAmount({
			currentCapacityOwnershipAttoRep: 0n,
			vaultAttoRepBacking,
			repPerEthPrice,
			statoblastSecurityMultiplierBps,
		})

		expect(maxCapacityOwnershipAttoRep).toBe(1_666_666_666_666_666_666n)
		if (maxCapacityOwnershipAttoRep === undefined) throw new Error('capacity ownership')
		expect(maxCapacityOwnershipAttoRep * repPerEthPrice * statoblastSecurityMultiplierBps <= vaultAttoRepBacking * 10n ** 18n * 10_000n).toBe(true)
		expect((maxCapacityOwnershipAttoRep + 1n) * repPerEthPrice * statoblastSecurityMultiplierBps > vaultAttoRepBacking * 10n ** 18n * 10_000n).toBe(true)
	})

	void test('capacity ownership', () => {
		expect(
			getSecurityVaultMaxCapacityOwnershipAttoRepAmount({
				currentCapacityOwnershipAttoRep: 15n * 10n ** 18n,
				vaultAttoRepBacking: 20n * 10n ** 18n,
				repPerEthPrice: 10n ** 18n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: 50n * 10n ** 18n,
				totalCapacityOwnershipAttoRep: 30n * 10n ** 18n,
			}),
		).toBe(10n * 10n ** 18n)
		expect(
			getSecurityVaultMaxCapacityOwnershipAttoRepAmount({
				currentCapacityOwnershipAttoRep: 40n * 10n ** 18n,
				vaultAttoRepBacking: 50n * 10n ** 18n,
				repPerEthPrice: 10n ** 18n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: 10n * 10n ** 18n,
				totalCapacityOwnershipAttoRep: 40n * 10n ** 18n,
			}),
		).toBe(5n * 10n ** 18n)
	})

	void test('withdrawable REP is bounded by pool-held vault REP backing and pool caps', () => {
		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: 20n * 10n ** 18n,
				repPerEthPrice: 2n * 10n ** 18n,
				capacityOwnershipAttoRep: 3n * 10n ** 18n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: 10n * 10n ** 18n,
				totalCapacityOwnershipAttoRep: 2n * 10n ** 18n,
			}),
		).toBe(2_000_000_000_000_000_000n)
	})

	void test('capacity ownership', () => {
		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: 10n * 10n ** 18n,
				repPerEthPrice: 2n * 10n ** 18n,
				capacityOwnershipAttoRep: 1n * 10n ** 18n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: 50n * 10n ** 18n,
				totalCapacityOwnershipAttoRep: 1n * 10n ** 18n,
			}),
		).toBe(6_000_000_000_000_000_000n)

		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: 10n * 10n ** 18n,
				repPerEthPrice: 5n * 10n ** 18n,
				capacityOwnershipAttoRep: 10n * 10n ** 18n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: 100n * 10n ** 18n,
				totalCapacityOwnershipAttoRep: 20n * 10n ** 18n,
			}),
		).toBe(0n)
	})

	void test('requires multiplier context and rounds the required REP backing up', () => {
		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: 10n * 10n ** 18n,
				repPerEthPrice: 3n * 10n ** 18n,
				capacityOwnershipAttoRep: 1n * 10n ** 18n + 1n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: 10n * 10n ** 18n,
				totalCapacityOwnershipAttoRep: 1n * 10n ** 18n + 1n,
			}),
		).toBe(3_999_999_999_999_999_994n)
		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: 10n * 10n ** 18n,
				repPerEthPrice: 3n * 10n ** 18n,
				capacityOwnershipAttoRep: 1n * 10n ** 18n,
				statoblastSecurityMultiplierBps: undefined,
			}),
		).toBe(undefined)
	})

	void test('uses floor plus one for strict migration backing at integral and non-integral boundaries', () => {
		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: 10n,
				repPerEthPrice: 10n ** 18n,
				capacityOwnershipAttoRep: 1n,
				statoblastSecurityMultiplierBps: 20_000n,
			}),
		).toBe(8n)
		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: 10n,
				repPerEthPrice: 10n ** 18n,
				capacityOwnershipAttoRep: 2n,
				statoblastSecurityMultiplierBps: 20_000n,
			}),
		).toBe(6n)
	})
})
