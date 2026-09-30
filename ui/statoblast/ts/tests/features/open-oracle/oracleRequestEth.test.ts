/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getOracleOperationTimingGuard, getOracleRequestEthGuardMessage, resolveOracleOperationEthFunding } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/oracleRequestEth.js'
import type { OracleManagerDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { createOracleManagerDetails as createBaseOracleManagerDetails } from '../security-pools/workflow/builders.js'

function createOracleManagerDetails(overrides: Partial<OracleManagerDetails> = {}): OracleManagerDetails {
	return createBaseOracleManagerDetails({
		isPriceValid: false,
		lastPrice: 2n * 10n ** 18n,
		priceValidUntilTimestamp: undefined,
		queuedOperationCostAttoEth: 2n,
		requestPriceCostAttoEth: 10n,
		token1: undefined,
		token2: undefined,
		...overrides,
	})
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
			costAttoEth: 0n,
			includeBuffer: false,
		})
	})

	test('uses the fresh-request fee when no report or bounded queue exists', () => {
		expect(
			resolveOracleOperationEthFunding({
				managerDetails: createOracleManagerDetails(),
			}),
		).toEqual({
			costAttoEth: 10n,
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
			costAttoEth: 0n,
			includeBuffer: false,
		})
	})

	test('uses fresh-request funding when a caller identifies a cached valid price as expired', () => {
		expect(
			resolveOracleOperationEthFunding({
				managerDetails: createOracleManagerDetails({
					isPriceValid: true,
				}),
				priceUsable: false,
			}),
		).toEqual({
			costAttoEth: 10n,
			includeBuffer: true,
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
			costAttoEth: 0n,
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
			costAttoEth: 0n,
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
			costAttoEth: 0n,
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
			costAttoEth: 0n,
			includeBuffer: false,
		})
	})

	test('does not gate zero-cost operations on wallet ETH balance loading', () => {
		expect(
			getOracleRequestEthGuardMessage({
				actionLabel: 'queue this liquidation',
				requiredCostAttoEth: 0n,
				walletBalanceAttoEth: undefined,
			}),
		).toBeUndefined()
	})
})

test('fresh-price coordinator routes require known timing and a full submission window', () => {
	const details = createOracleManagerDetails({ isPriceValid: true, priceValidUntilTimestamp: 100n })
	for (const timestamp of [undefined, 40n, 99n, 100n, 101n]) expect(getOracleOperationTimingGuard(details, timestamp)).toBeDefined()
	expect(getOracleOperationTimingGuard(details, 39n)).toBeUndefined()
	expect(getOracleOperationTimingGuard({ ...details, priceValidUntilTimestamp: undefined }, 1n)).toBeDefined()
	expect(getOracleOperationTimingGuard({ ...details, isPriceValid: false }, undefined)).toBeUndefined()
})
