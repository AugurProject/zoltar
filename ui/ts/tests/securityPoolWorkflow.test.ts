/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from 'viem'
import { getCurrentPoolOracleManagerDetails, getOracleLastPriceDisplay, getOraclePriceExpiryDisplay, getSelectedPoolCardTitle, getSelectedPoolLookupDisplay, getSelectedPoolOracleMetricValues, isForkWorkflowDisabled, shouldShowSelectedPoolWorkflowDetails } from '../components/SecurityPoolWorkflowSection.js'
import { ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS } from '../lib/securityVault.js'

void describe('selected pool workflow lookup state', () => {
	void test('uses a stable card title until a pool resolves', () => {
		expect(
			getSelectedPoolCardTitle({
				hasSelectedPoolAddress: false,
				resolvedPoolTitle: undefined,
			}),
		).toBe('Select a security pool')

		expect(
			getSelectedPoolCardTitle({
				hasSelectedPoolAddress: true,
				resolvedPoolTitle: undefined,
			}),
		).toBe('Selected Pool')

		expect(
			getSelectedPoolCardTitle({
				hasSelectedPoolAddress: true,
				resolvedPoolTitle: 'Will REP exceed threshold?',
			}),
		).toBe('Will REP exceed threshold?')
	})

	void test('adds only the empty selected-pool state on top of loadable lookup states', () => {
		expect(
			getSelectedPoolLookupDisplay({
				hasSelectedPoolAddress: false,
				selectedPoolLookupState: 'unknown',
			}),
		).toBe('empty')

		expect(
			getSelectedPoolLookupDisplay({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'unknown',
			}),
		).toBe('unknown')

		expect(
			getSelectedPoolLookupDisplay({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'loading',
			}),
		).toBe('loading')

		expect(
			getSelectedPoolLookupDisplay({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'missing',
			}),
		).toBe('missing')

		expect(
			getSelectedPoolLookupDisplay({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'ready',
			}),
		).toBe('ready')
	})
})

void describe('selected pool workflow visibility', () => {
	void test('shows workflow details only for a resolved pool in the active universe', () => {
		expect(
			shouldShowSelectedPoolWorkflowDetails({
				hasSelectedPoolAddress: false,
				selectedPoolExists: false,
				selectedPoolUniverseMismatch: false,
			}),
		).toBe(false)

		expect(
			shouldShowSelectedPoolWorkflowDetails({
				hasSelectedPoolAddress: true,
				selectedPoolExists: false,
				selectedPoolUniverseMismatch: false,
			}),
		).toBe(false)

		expect(
			shouldShowSelectedPoolWorkflowDetails({
				hasSelectedPoolAddress: true,
				selectedPoolExists: true,
				selectedPoolUniverseMismatch: true,
			}),
		).toBe(false)

		expect(
			shouldShowSelectedPoolWorkflowDetails({
				hasSelectedPoolAddress: true,
				selectedPoolExists: true,
				selectedPoolUniverseMismatch: false,
			}),
		).toBe(true)
	})

	void test('disables the fork workflow only while the selected pool remains operational', () => {
		expect(isForkWorkflowDisabled(undefined)).toBe(true)
		expect(isForkWorkflowDisabled('operational')).toBe(true)
		expect(isForkWorkflowDisabled('operational', true)).toBe(false)
		expect(isForkWorkflowDisabled('poolForked')).toBe(false)
		expect(isForkWorkflowDisabled('forkMigration')).toBe(false)
		expect(isForkWorkflowDisabled('forkTruthAuction')).toBe(false)
	})
})

void describe('selected pool oracle price display', () => {
	void test('uses oracle manager details only when they match the selected pool manager', () => {
		const poolOracleManagerDetails = {
			callbackStateHash: undefined,
			exactToken1Report: undefined,
			isPriceValid: true,
			lastPrice: 42n,
			lastSettlementTimestamp: 1n,
			managerAddress: zeroAddress,
			openOracleAddress: zeroAddress,
			pendingReportId: 0n,
			priceValidUntilTimestamp: 2n,
			requestPriceEthCost: 3n,
			token1: undefined,
			token2: undefined,
		}

		expect(
			getCurrentPoolOracleManagerDetails({
				poolOracleManagerDetails,
				selectedPoolManagerAddress: zeroAddress,
			}),
		).toBe(poolOracleManagerDetails)

		expect(
			getCurrentPoolOracleManagerDetails({
				poolOracleManagerDetails,
				selectedPoolManagerAddress: '0x0000000000000000000000000000000000000001',
			}),
		).toBe(undefined)
	})

	void test('hides stale oracle manager details from a previously opened pool', () => {
		expect(
			getCurrentPoolOracleManagerDetails({
				poolOracleManagerDetails: {
					callbackStateHash: undefined,
					exactToken1Report: undefined,
					isPriceValid: false,
					lastPrice: 0n,
					lastSettlementTimestamp: 0n,
					managerAddress: getAddress('0x0000000000000000000000000000000000000002'),
					openOracleAddress: zeroAddress,
					pendingReportId: 0n,
					priceValidUntilTimestamp: undefined,
					requestPriceEthCost: 0n,
					token1: undefined,
					token2: undefined,
				},
				selectedPoolManagerAddress: '0x0000000000000000000000000000000000000003',
			}),
		).toBe(undefined)
	})

	void test('shows a dash when the oracle price has never been settled', () => {
		expect(
			getOracleLastPriceDisplay(
				getSelectedPoolOracleMetricValues({
					lastOraclePrice: undefined,
					lastOracleSettlementTimestamp: 0n,
				}),
			),
		).toBe('-')
	})

	void test('keeps settled prices numeric, including zero', () => {
		expect(
			getOracleLastPriceDisplay(
				getSelectedPoolOracleMetricValues({
					lastOraclePrice: 0n,
					lastOracleSettlementTimestamp: 1n,
				}),
			),
		).toBe('≈ 0.00 REP / ETH')

		expect(
			getOracleLastPriceDisplay(
				getSelectedPoolOracleMetricValues({
					lastOraclePrice: 42n * 10n ** 18n,
					lastOracleSettlementTimestamp: 1n,
				}),
			),
		).toBe('≈ 42.00 REP / ETH')
	})

	void test('derives expiry countdowns from the last settlement when manager details are not loaded', () => {
		expect(
			getOraclePriceExpiryDisplay({
				currentTimestamp: 31n,
				lastSettlementTimestamp: 1n,
				priceValidUntilTimestamp: undefined,
			}),
		).toBe('59m')
	})

	void test('shows a dash before the oracle has ever settled and expired once the price window closes', () => {
		expect(
			getOraclePriceExpiryDisplay({
				currentTimestamp: 100n,
				lastSettlementTimestamp: 0n,
				priceValidUntilTimestamp: undefined,
			}),
		).toBe('-')

		expect(
			getOraclePriceExpiryDisplay({
				currentTimestamp: 100n + ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS,
				lastSettlementTimestamp: 100n,
				priceValidUntilTimestamp: 100n + ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS,
			}),
		).toBe('Expired')
	})
})
