/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { parseOptionalRepAmountInput, parseRepAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { doesLoadedSecurityVaultMatchSelection, doesSecurityVaultExistOnchain, getSecurityVaultWithdrawableRepAmount, getSelectedVaultOwner, isOracleManagerPriceUsable, isSelectedVaultOwnedByAccount } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityVault.js'
import { getOracleManagerPriceValidUntilTimestamp } from '@zoltar/ui-statoblast-shared/protocol/oracleTiming.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { createMulticallStub, createReadContractStub, getContractFunctionName } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { loadSecurityVaultDetails } from '@zoltar/ui-statoblast-shared/protocol/securityPools.js'

// A pool minimum as loaded from SecurityPool.minimumVaultRepDepositAttoRep.
const POOL_MINIMUM_VAULT_REP_ATTO_REP = 10n * 10n ** 18n

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
			underwritingLimitAttoEth: 0n,
			securityPoolAddress,
			totalUnderwritingLimitAttoEth: 0n,
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
			underwritingLimitAttoEth: 0n,
			securityPoolAddress: zeroAddress,
			totalUnderwritingLimitAttoEth: 0n,
			claimableFeesAttoEth: 0n,
			universeId: 0n,
			vaultAddress: zeroAddress,
		}

		expect(doesSecurityVaultExistOnchain(details)).toBe(true)
	})

	void test('parses security vault REP inputs as 18-decimal token amounts', () => {
		expect(parseRepAmountInput('10', 'REP backing amount')).toBe(POOL_MINIMUM_VAULT_REP_ATTO_REP)
		expect(parseRepAmountInput('10.5', 'REP backing amount')).toBe(105n * 10n ** 17n)
		expect(parseRepAmountInput('0.25', 'REP withdrawal amount')).toBe(25n * 10n ** 16n)
		expect(parseOptionalRepAmountInput('1')).toBe(10n ** 18n)
		expect(parseOptionalRepAmountInput('1.5')).toBe(15n * 10n ** 17n)
		expect(parseOptionalRepAmountInput('abc')).toBe(undefined)
	})

	void test('formats Max-style REP input amounts without grouped separators or raw base units', () => {
		expect(formatCurrencyInputBalance(POOL_MINIMUM_VAULT_REP_ATTO_REP)).toBe('10')
		expect(formatCurrencyInputBalance(105n * 10n ** 17n)).toBe('10.5')
		expect(formatCurrencyInputBalance(1234567890000000000000n)).toBe('1234.56789')
	})

	void test('derives the oracle price expiry timestamp from the last settlement time', () => {
		expect(getOracleManagerPriceValidUntilTimestamp(undefined)).toBe(undefined)
		expect(getOracleManagerPriceValidUntilTimestamp(0n)).toBe(undefined)
		expect(getOracleManagerPriceValidUntilTimestamp(15n)).toBe(15n + 60n * 60n)
		expect(getOracleManagerPriceValidUntilTimestamp(15n, 1)).toBe(315n)
		expect(getOracleManagerPriceValidUntilTimestamp(15n, 11155111)).toBe(3615n)
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

	void test('pins every vault and pool-total read to one block', async () => {
		const pinnedBlockNumber = 77n
		const readBlockNumbers = new Map<string, bigint | undefined>()
		const readValues: Record<string, unknown> = {
			currentRetentionRate: 0n,
			escalationGame: getAddress('0x00000000000000000000000000000000000000e1'),
			getTotalPoolHeldAttoRep: 100n * 10n ** 18n,
			getVaultCapacityBackingFactorsBps: [0n, 0n],
			getVaultOpenInterestAttoEth: 0n,
			minimumSecurityBondDebtAttoEth: 0n,
			minimumVaultRepDepositAttoRep: 10n * 10n ** 18n,
			openOraclePriceCoordinator: getAddress('0x00000000000000000000000000000000000000d1'),
			repToken: getAddress('0x00000000000000000000000000000000000000a2'),
			settlementCollateralAttoEth: 0n,
			statoblastSecurityMultiplierBps: 20_000n,
			symbol: 'REP',
			totalRepBackingUnits: 100n * 10n ** 18n,
			totalUnderwritingLimitAttoEth: 0n,
			universeId: 0n,
			vaultBadDebtAttoEth: 0n,
		}
		const client = createConnectedReadClient()
		const getCode: typeof client.getCode = async () => '0x01'
		const getBlockNumber: typeof client.getBlockNumber = async () => pinnedBlockNumber
		client.getCode = getCode
		client.getBlockNumber = getBlockNumber
		client.readContract = createReadContractStub(async request => {
			readBlockNumbers.set(request.functionName, request.blockNumber)
			if (!(request.functionName in readValues)) throw new Error(`Unexpected read: ${request.functionName}`)
			return readValues[request.functionName]
		})
		client.multicall = createMulticallStub(async request => {
			const functionNames = request.contracts.map(getContractFunctionName)
			if (functionNames.includes('securityVaults')) {
				readBlockNumbers.set('checkpointed vault multicall', request.blockNumber)
				// Each vault is read right after its fee checkpoint in the same batch.
				return functionNames.map(functionName => ({ result: functionName === 'securityVaults' ? [50n * 10n ** 18n, 0n, 0n, 0n] : undefined, status: 'success' }))
			}
			readBlockNumbers.set('escalation multicall', request.blockNumber)
			return request.contracts.map(() => 0n)
		})

		const details = await loadSecurityVaultDetails(client, getAddress('0x00000000000000000000000000000000000000b1'), getAddress('0x00000000000000000000000000000000000000c1'))

		expect(details?.totalPoolHeldRepBalanceAttoRep).toBe(100n * 10n ** 18n)
		// A read left on the latest block could mix the vault's units with pool totals from another block in the deposit rounding.
		expect([...readBlockNumbers.keys()].sort()).toEqual([...Object.keys(readValues), 'checkpointed vault multicall', 'escalation multicall'].sort())
		for (const [read, blockNumber] of readBlockNumbers) expect({ read, blockNumber }).toEqual({ read, blockNumber: pinnedBlockNumber })
	})

	void test('returns zero or no withdrawal when balance inputs are missing or blocked', () => {
		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: undefined,
				repPerEthPrice: 0n,
				underwritingLimitAttoEth: 0n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: undefined,
				totalUnderwritingLimitAttoEth: undefined,
			}),
		).toBe(undefined)
		expect(
			getSecurityVaultWithdrawableRepAmount({
				disputeStakedAttoRep: 1n,
				vaultAttoRepBacking: 10n * 10n ** 18n,
				repPerEthPrice: 0n,
				underwritingLimitAttoEth: 0n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: undefined,
				totalUnderwritingLimitAttoEth: undefined,
			}),
		).toBe(0n)
		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: 10n * 10n ** 18n,
				repPerEthPrice: 0n,
				underwritingLimitAttoEth: 0n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: undefined,
				totalUnderwritingLimitAttoEth: undefined,
			}),
		).toBe(10n * 10n ** 18n)
	})

	void test('withdrawable REP is bounded by pool-held vault REP backing and pool caps', () => {
		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: 20n * 10n ** 18n,
				repPerEthPrice: 2n * 10n ** 18n,
				underwritingLimitAttoEth: 3n * 10n ** 18n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: 10n * 10n ** 18n,
				totalUnderwritingLimitAttoEth: 2n * 10n ** 18n,
			}),
		).toBe(2_000_000_000_000_000_000n)
	})

	void test('withdrawable REP retains the backing required by active underwriting commitments', () => {
		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: 10n * 10n ** 18n,
				repPerEthPrice: 2n * 10n ** 18n,
				underwritingLimitAttoEth: 1n * 10n ** 18n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: 50n * 10n ** 18n,
				totalUnderwritingLimitAttoEth: 1n * 10n ** 18n,
			}),
		).toBe(6_000_000_000_000_000_000n)

		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: 10n * 10n ** 18n,
				repPerEthPrice: 5n * 10n ** 18n,
				underwritingLimitAttoEth: 10n * 10n ** 18n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: 100n * 10n ** 18n,
				totalUnderwritingLimitAttoEth: 20n * 10n ** 18n,
			}),
		).toBe(0n)
	})

	void test('requires multiplier context and rounds the required REP backing up', () => {
		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: 10n * 10n ** 18n,
				repPerEthPrice: 3n * 10n ** 18n,
				underwritingLimitAttoEth: 1n * 10n ** 18n + 1n,
				statoblastSecurityMultiplierBps: 20_000n,
				totalPoolHeldAttoRep: 10n * 10n ** 18n,
				totalUnderwritingLimitAttoEth: 1n * 10n ** 18n + 1n,
			}),
		).toBe(3_999_999_999_999_999_994n)
		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: 10n * 10n ** 18n,
				repPerEthPrice: 3n * 10n ** 18n,
				underwritingLimitAttoEth: 1n * 10n ** 18n,
				statoblastSecurityMultiplierBps: undefined,
			}),
		).toBe(undefined)
	})

	void test('uses floor plus one for strict migration backing at integral and non-integral boundaries', () => {
		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: 10n,
				repPerEthPrice: 10n ** 18n,
				underwritingLimitAttoEth: 1n,
				statoblastSecurityMultiplierBps: 20_000n,
			}),
		).toBe(8n)
		expect(
			getSecurityVaultWithdrawableRepAmount({
				vaultAttoRepBacking: 10n,
				repPerEthPrice: 10n ** 18n,
				underwritingLimitAttoEth: 2n,
				statoblastSecurityMultiplierBps: 20_000n,
			}),
		).toBe(6n)
	})
})

// SecurityPool._requirePoolCoverage runs isVaultHealthy on pool totals, so the pool also keeps REP at the migration multiplier max(10_000 + (m - 10_000) / 2, 10_500) bps.
test('withdrawal estimate keeps the pool-wide migration reserve with ceil rounding', () => {
	expect(getSecurityVaultWithdrawableRepAmount({ vaultAttoRepBacking: 20n * 10n ** 18n, underwritingLimitAttoEth: 0n, repPerEthPrice: 10n ** 18n, statoblastSecurityMultiplierBps: 10_000n, totalPoolHeldAttoRep: 20n * 10n ** 18n, totalUnderwritingLimitAttoEth: 10n * 10n ** 18n })).toBe(95n * 10n ** 17n)
	expect(getSecurityVaultWithdrawableRepAmount({ vaultAttoRepBacking: 10n, underwritingLimitAttoEth: 0n, repPerEthPrice: 10n ** 18n, statoblastSecurityMultiplierBps: 10_000n, totalPoolHeldAttoRep: 10n, totalUnderwritingLimitAttoEth: 1n })).toBe(8n)
	expect(getSecurityVaultWithdrawableRepAmount({ vaultAttoRepBacking: 200n, underwritingLimitAttoEth: 0n, repPerEthPrice: 10n ** 18n, statoblastSecurityMultiplierBps: 10_400n, totalPoolHeldAttoRep: 200n, totalUnderwritingLimitAttoEth: 100n })).toBe(95n)
})

test('withdrawal estimate preserves nested full-limit rounding and the liquidation reserve', () => {
	expect(getSecurityVaultWithdrawableRepAmount({ vaultAttoRepBacking: 10n, underwritingLimitAttoEth: 1n, repPerEthPrice: 1n, statoblastSecurityMultiplierBps: 20_000n })).toBe(8n)
	expect(getSecurityVaultWithdrawableRepAmount({ vaultAttoRepBacking: 200n, underwritingLimitAttoEth: 100n, repPerEthPrice: 10n ** 18n, statoblastSecurityMultiplierBps: 10_000n })).toBe(95n)
})

void test('a partial withdrawal maximum keeps the vault minimum unless coverage allows a full exit', () => {
	const minimum = 10n * 10n ** 18n
	// A commitment locks 4 REP of 20: withdrawing more than 10 would leave less than the minimum and exit the whole vault, which coverage rejects.
	expect(getSecurityVaultWithdrawableRepAmount({ vaultAttoRepBacking: 20n * 10n ** 18n, repPerEthPrice: 2n * 10n ** 18n, underwritingLimitAttoEth: 10n ** 18n, statoblastSecurityMultiplierBps: 20_000n, minimumVaultRepDepositAttoRep: minimum })).toBe(10n * 10n ** 18n)
	// Without a commitment the whole vault can leave.
	expect(getSecurityVaultWithdrawableRepAmount({ vaultAttoRepBacking: 20n * 10n ** 18n, repPerEthPrice: undefined, underwritingLimitAttoEth: 0n, statoblastSecurityMultiplierBps: 20_000n, minimumVaultRepDepositAttoRep: minimum })).toBe(20n * 10n ** 18n)
	// A committed vault at the minimum cannot withdraw anything partially.
	expect(getSecurityVaultWithdrawableRepAmount({ vaultAttoRepBacking: minimum, repPerEthPrice: 10n ** 18n, underwritingLimitAttoEth: 1n, statoblastSecurityMultiplierBps: 20_000n, minimumVaultRepDepositAttoRep: minimum })).toBe(0n)
})
