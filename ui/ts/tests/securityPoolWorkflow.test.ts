/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from 'viem'
import {
	getCurrentPoolOracleManagerDetails,
	getOracleLastPriceDisplay,
	getOraclePriceExpiryDisplay,
	getSelectedPoolCardTitle,
	getSelectedPoolOracleMetricValues,
	getSelectedPoolWorkflowGuardMessage,
	getSelectedPoolWorkflowLockedPresentation,
	isForkWorkflowDisabled,
	resolveSelectedPoolView,
	shouldShowSelectedPoolWorkflowDetails,
} from '../components/SecurityPoolWorkflowSection.js'
import { ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS } from '../lib/securityVault.js'

void describe('selected pool workflow lookup state', () => {
	void test('uses a single stable operate header title', () => {
		expect(getSelectedPoolCardTitle()).toBe('Operate Security Pool')

		expect(getSelectedPoolCardTitle()).toBe('Operate Security Pool')

		expect(getSelectedPoolCardTitle()).toBe('Operate Security Pool')
	})

	void test('maps the legacy resolution view alias to the reporting tab', () => {
		expect(resolveSelectedPoolView(undefined)).toBe('vaults')
		expect(resolveSelectedPoolView('resolution')).toBe('reporting')
		expect(resolveSelectedPoolView('reporting')).toBe('reporting')
		expect(resolveSelectedPoolView('fork')).toBe('fork')
		expect(resolveSelectedPoolView('oracle')).toBe('staged-operations')
		expect(resolveSelectedPoolView('price-oracle')).toBe('price-oracle')
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

	void test('uses state-specific reasons before unlocking pool workflows', () => {
		expect(
			getSelectedPoolWorkflowGuardMessage({
				hasSelectedPoolAddress: false,
				selectedPoolLookupState: 'unknown',
				selectedPoolUniverseMismatch: false,
			}),
		).toBe('Load a pool to open this workflow.')

		expect(
			getSelectedPoolWorkflowGuardMessage({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'loading',
				selectedPoolUniverseMismatch: false,
			}),
		).toBe('Wait for this pool to finish loading.')

		expect(
			getSelectedPoolWorkflowGuardMessage({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'missing',
				selectedPoolUniverseMismatch: false,
			}),
		).toBe('Load a valid pool to open this workflow.')

		expect(
			getSelectedPoolWorkflowGuardMessage({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'ready',
				selectedPoolUniverseMismatch: true,
			}),
		).toBe('Switch to the same universe before using this pool workflow.')
	})

	void test('keeps a stable locked-workflow presentation before a pool resolves', () => {
		expect(
			getSelectedPoolWorkflowLockedPresentation({
				hasSelectedPoolAddress: false,
				selectedPoolLookupState: 'unknown',
				selectedPoolUniverseMismatch: false,
			}),
		).toEqual({
			badgeLabel: 'No pool selected',
			badgeTone: 'muted',
			detail: 'No pool selected.',
			key: 'action_needed',
		})

		expect(
			getSelectedPoolWorkflowLockedPresentation({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'loading',
				selectedPoolUniverseMismatch: false,
			}),
		).toEqual({
			detail: 'Loading...',
			detailIsLoading: true,
			key: 'loading',
		})

		expect(
			getSelectedPoolWorkflowLockedPresentation({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'ready',
				selectedPoolUniverseMismatch: true,
			}),
		).toEqual({
			actionHint: 'Switch to the matching universe first.',
			badgeLabel: 'Unavailable',
			badgeTone: 'blocked',
			detail: 'Switch to the same universe before using vault, trading, reporting, and fork workflows.',
			key: 'unavailable',
		})
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
			pendingOperation: undefined,
			pendingOperationSlotId: 0n,
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
					pendingOperation: undefined,
					pendingOperationSlotId: 0n,
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
