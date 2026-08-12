/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { getLiquidationNoticeState } from '../../../features/security-pools/lib/liquidationStatus.js'
import { createOracleManagerDetails } from './workflow/builders.js'

describe('liquidation notice state', () => {
	test('does not describe an expired oracle price as a successful liquidation', () => {
		const currentPoolOracleManagerDetails = createOracleManagerDetails({
			isPriceValid: true,
			lastSettlementTimestamp: 100n,
			priceValidUntilTimestamp: 400n,
		})
		const securityPoolOverviewResult = {
			action: 'queueLiquidation' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000a1' as const,
			securityPoolAddress: zeroAddress,
		}

		expect(
			getLiquidationNoticeState({
				currentPoolOracleManagerDetails,
				currentTimestamp: 399n,
				liquidationTargetVault: zeroAddress,
				loadingPoolOracleManager: false,
				securityPoolOverviewResult,
			}),
		).toBe('successful')
		expect(
			getLiquidationNoticeState({
				currentPoolOracleManagerDetails,
				currentTimestamp: 400n,
				liquidationTargetVault: zeroAddress,
				loadingPoolOracleManager: false,
				securityPoolOverviewResult,
			}),
		).toBe('submitted')
	})
})
