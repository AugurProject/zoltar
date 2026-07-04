/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { getOracleRequestEthGuardMessage, resolveOracleOperationEthFunding } from '../lib/oracleRequestEth.js'
import type { OracleManagerDetails } from '../types/contracts.js'

function createOracleManagerDetails(overrides: Partial<OracleManagerDetails> = {}): OracleManagerDetails {
	return {
		callbackStateHash: undefined,
		exactToken1Report: undefined,
		isPriceValid: false,
		lastPrice: 2n * 10n ** 18n,
		lastSettlementTimestamp: 1n,
		managerAddress: zeroAddress,
		openOracleAddress: zeroAddress,
		pendingOperation: undefined,
		pendingOperationSlotId: 0n,
		pendingSettlementOperationIds: [],
		pendingSettlementQueueCapacity: 4n,
		pendingReportId: 0n,
		priceRoundRemainingNotional: 0n,
		priceValidUntilTimestamp: undefined,
		queuedOperationEthCost: 2n,
		requestPriceEthCost: 10n,
		token1: undefined,
		token2: undefined,
		...overrides,
	}
}

describe('oracle request ETH funding', () => {
	test('uses the queued-op fee when joining a pending report', () => {
		expect(
			resolveOracleOperationEthFunding({
				amount: 1n,
				currentTargetAllowance: undefined,
				currentTargetRepDeposit: undefined,
				managerDetails: createOracleManagerDetails({
					pendingReportId: 7n,
					pendingSettlementOperationIds: [1n],
				}),
				operation: 'withdrawRep',
			}),
		).toEqual({
			ethCost: 2n,
			includeBuffer: true,
		})
	})

	test('uses the fresh-request fee when no report or bounded queue exists', () => {
		expect(
			resolveOracleOperationEthFunding({
				amount: 1n,
				currentTargetAllowance: undefined,
				currentTargetRepDeposit: undefined,
				managerDetails: createOracleManagerDetails(),
				operation: 'withdrawRep',
			}),
		).toEqual({
			ethCost: 10n,
			includeBuffer: true,
		})
	})

	test('uses no ETH when a valid price can execute the operation immediately', () => {
		expect(
			resolveOracleOperationEthFunding({
				amount: 2n * 10n ** 18n,
				currentTargetAllowance: undefined,
				currentTargetRepDeposit: undefined,
				managerDetails: createOracleManagerDetails({
					isPriceValid: true,
					priceRoundRemainingNotional: 1n * 10n ** 18n,
				}),
				operation: 'withdrawRep',
			}),
		).toEqual({
			ethCost: 0n,
			includeBuffer: false,
		})
	})

	test('uses no ETH for overflow operations outside the bounded settlement queue', () => {
		expect(
			resolveOracleOperationEthFunding({
				amount: 1n,
				currentTargetAllowance: undefined,
				currentTargetRepDeposit: undefined,
				managerDetails: createOracleManagerDetails({
					pendingReportId: 3n,
					pendingSettlementOperationIds: [1n, 2n, 3n, 4n],
				}),
				operation: 'withdrawRep',
			}),
		).toEqual({
			ethCost: 0n,
			includeBuffer: false,
		})
	})

	test('uses the manager queue-capacity value instead of a hard-coded UI threshold', () => {
		expect(
			resolveOracleOperationEthFunding({
				amount: 1n,
				currentTargetAllowance: undefined,
				currentTargetRepDeposit: undefined,
				managerDetails: createOracleManagerDetails({
					pendingSettlementOperationIds: [1n, 2n, 3n, 4n],
					pendingSettlementQueueCapacity: 5n,
					pendingReportId: 3n,
				}),
				operation: 'withdrawRep',
			}),
		).toEqual({
			ethCost: 2n,
			includeBuffer: true,
		})
	})

	test('uses no ETH for immediate liquidations that fit within the remaining round budget', () => {
		expect(
			resolveOracleOperationEthFunding({
				amount: 2n * 10n ** 18n,
				currentTargetAllowance: 4n * 10n ** 18n,
				currentTargetRepDeposit: 12n * 10n ** 18n,
				managerDetails: createOracleManagerDetails({
					isPriceValid: true,
					lastPrice: 2n * 10n ** 18n,
					priceRoundRemainingNotional: 6n * 10n ** 18n,
				}),
				operation: 'liquidation',
			}),
		).toEqual({
			ethCost: 0n,
			includeBuffer: false,
		})
	})

	test('uses the fresh-request fee when a liquidation exceeds the remaining round budget', () => {
		expect(
			resolveOracleOperationEthFunding({
				amount: 4n * 10n ** 18n,
				currentTargetAllowance: 4n * 10n ** 18n,
				currentTargetRepDeposit: 12n * 10n ** 18n,
				managerDetails: createOracleManagerDetails({
					isPriceValid: true,
					lastPrice: 2n * 10n ** 18n,
					priceRoundRemainingNotional: 5n * 10n ** 18n,
				}),
				operation: 'liquidation',
			}),
		).toEqual({
			ethCost: 10n,
			includeBuffer: true,
		})
	})

	test('does not gate zero-cost operations on wallet ETH balance loading', () => {
		expect(
			getOracleRequestEthGuardMessage({
				actionLabel: 'queue this liquidation',
				requiredEthCost: 0n,
				walletEthBalance: undefined,
			}),
		).toBeUndefined()
	})
})
