/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { getOracleRequestEthGuardMessage, resolveOracleOperationEthFunding } from '../../../features/open-oracle/lib/oracleRequestEth.js'
import type { OracleManagerDetails } from '../../../types/contracts.js'

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
		priceValidUntilTimestamp: undefined,
		queuedOperationEthCost: 2n,
		requestPriceEthCost: 10n,
		token1: undefined,
		token2: undefined,
		...overrides,
	}
}

describe('oracle request ETH funding', () => {
	test('uses no ETH when reusing a pending report queue slot', () => {
		expect(
			resolveOracleOperationEthFunding({
				managerDetails: createOracleManagerDetails({
					pendingReportId: 7n,
					pendingSettlementOperationIds: [1n],
				}),
			}),
		).toEqual({
			ethCost: 0n,
			includeBuffer: false,
		})
	})

	test('uses the fresh-request fee when no report or bounded queue exists', () => {
		expect(
			resolveOracleOperationEthFunding({
				managerDetails: createOracleManagerDetails(),
			}),
		).toEqual({
			ethCost: 10n,
			includeBuffer: true,
		})
	})

	test('uses no ETH when a valid price can execute the operation immediately', () => {
		expect(
			resolveOracleOperationEthFunding({
				managerDetails: createOracleManagerDetails({
					isPriceValid: true,
				}),
			}),
		).toEqual({
			ethCost: 0n,
			includeBuffer: false,
		})
	})

	test('uses no ETH for overflow operations outside the bounded settlement queue', () => {
		expect(
			resolveOracleOperationEthFunding({
				managerDetails: createOracleManagerDetails({
					pendingReportId: 3n,
					pendingSettlementOperationIds: [1n, 2n, 3n, 4n],
				}),
			}),
		).toEqual({
			ethCost: 0n,
			includeBuffer: false,
		})
	})

	test('uses the manager queue-capacity value instead of a hard-coded UI threshold', () => {
		expect(
			resolveOracleOperationEthFunding({
				managerDetails: createOracleManagerDetails({
					pendingSettlementOperationIds: [1n, 2n, 3n, 4n],
					pendingSettlementQueueCapacity: 5n,
					pendingReportId: 3n,
				}),
			}),
		).toEqual({
			ethCost: 0n,
			includeBuffer: false,
		})
	})

	test('uses no ETH for immediate liquidations when the current price is valid', () => {
		expect(
			resolveOracleOperationEthFunding({
				managerDetails: createOracleManagerDetails({
					isPriceValid: true,
					lastPrice: 2n * 10n ** 18n,
				}),
			}),
		).toEqual({
			ethCost: 0n,
			includeBuffer: false,
		})
	})

	test('uses no ETH for immediate liquidations even when large external exposure is at stake', () => {
		expect(
			resolveOracleOperationEthFunding({
				managerDetails: createOracleManagerDetails({
					isPriceValid: true,
					lastPrice: 2n * 10n ** 18n,
				}),
			}),
		).toEqual({
			ethCost: 0n,
			includeBuffer: false,
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
