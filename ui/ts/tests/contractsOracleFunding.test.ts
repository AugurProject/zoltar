/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/shared/ethereum'
import { loadOracleManagerQueueOperationEthValue } from '../contracts.js'
import { addOpenOracleBountyBuffer } from '../lib/openOracle.js'

const MANAGER_ADDRESS = getAddress('0x0000000000000000000000000000000000000002')

describe('oracle manager queue funding helpers', () => {
	test('buffers queued-operation fees for pending-report joins', async () => {
		const readContract: Parameters<typeof loadOracleManagerQueueOperationEthValue>[0]['readContract'] = async request => {
			if (request.address === MANAGER_ADDRESS && request.functionName === 'lastPrice') return (10n ** 18n) as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getPendingSettlementOperationIds') return [1n] as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'MAX_PENDING_SETTLEMENT_OPERATIONS') return 4n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'pendingReportId') return 7n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getQueuedOperationEthCost') return 2n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getRequestPriceEthCost') return 10n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'isPriceValid') return false as never
			throw new Error(`Unexpected read: ${request.address}.${request.functionName}`)
		}
		const client = { readContract }

		const ethValue = await loadOracleManagerQueueOperationEthValue(client, MANAGER_ADDRESS)

		expect(ethValue).toBe(addOpenOracleBountyBuffer(2n))
	})
})
