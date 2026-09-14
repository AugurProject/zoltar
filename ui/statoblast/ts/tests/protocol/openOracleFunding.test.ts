import { createReadContractStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { loadOracleManagerQueueOperationEthValue } from '@zoltar/ui-statoblast-shared/protocol/oracleCoordinator.js'

const MANAGER_ADDRESS = getAddress('0x0000000000000000000000000000000000000002')

describe('oracle manager queue funding helpers', () => {
	test('uses zero ETH when reusing a pending-report join slot', async () => {
		const readContract: Parameters<typeof loadOracleManagerQueueOperationEthValue>[0]['readContract'] = async request => {
			if (request.address === MANAGER_ADDRESS && request.functionName === 'lastPrice') return (10n ** 18n) as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getPendingSettlementOperationIds') return [1n] as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'MAX_PENDING_SETTLEMENT_OPERATIONS') return 4n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'pendingReportId') return 7n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getQueuedOperationCostAttoEth') return 2n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getSettlementCallbackGasLimit') return 10 as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'gasConsumedOpenOracleReportPrice') return 20n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'isPriceValid') return false as never
			throw new Error(`Unexpected read: ${request.address}.${request.functionName}`)
		}
		const client = { readContract, getBlock: async () => ({ timestamp: 0n, transactions: [], baseFeePerGas: 0n }) }

		const ethValue = await loadOracleManagerQueueOperationEthValue(client, MANAGER_ADDRESS)

		expect(ethValue).toBe(0n)
	})
})

test('includes the current block base fee in new oracle request funding', async () => {
	const readContract = createReadContractStub(async request => {
		switch (request.functionName) {
			case 'lastPrice':
				return 0n
			case 'getPendingSettlementOperationIds':
				return []
			case 'MAX_PENDING_SETTLEMENT_OPERATIONS':
				return 4n
			case 'pendingReportId':
				return 0n
			case 'getQueuedOperationCostAttoEth':
				return 0n
			case 'isPriceValid':
				return false
			case 'getSettlementCallbackGasLimit':
				expect(request.blockNumber).toBe(123n)
				return 20_000
			case 'gasConsumedOpenOracleReportPrice':
				expect(request.blockNumber).toBe(123n)
				return 5_000n
			default:
				throw new Error(`Unexpected read: ${request.functionName}`)
		}
	})
	const client = { readContract, getBlock: async () => ({ timestamp: 0n, transactions: [], number: 123n, baseFeePerGas: 10n }) }
	expect(await loadOracleManagerQueueOperationEthValue(client, MANAGER_ADDRESS)).toBe(1_200_122n)
})
