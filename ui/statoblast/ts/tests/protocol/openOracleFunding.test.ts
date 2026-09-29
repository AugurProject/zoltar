import { createMockLoaderClient, createReadContractStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { loadCoordinatorInitialReportFundingRequirement, loadOracleManagerQueueOperationEthValue } from '@zoltar/ui-statoblast-shared/protocol/oracleCoordinator.js'

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

for (const baseFeePerGas of [1_040_635_026n, 0n]) {
	test(`initial report funding includes the block base fee (${baseFeePerGas}) without funding a read caller`, async () => {
		const readContract = createReadContractStub(async request => {
			if (request.functionName === 'reputationToken') return MANAGER_ADDRESS
			if (request.functionName === 'balanceOf') return 2n * 10n ** 18n
			expect(request.blockNumber).toBe(11_806_221n)
			expect(request.gasPrice).toBeUndefined()
			switch (request.functionName) {
				case 'gasUnitsForOneDispute':
					return 300_000n
				case 'initialReportPriorityFeeAttoEthPerGas':
					return 10_000_000_000n
				case 'targetPriceErrorForDispute':
					return 500_000n
				case 'openOracleSecurityMultiplierBps':
					return 100_000n
				case 'protocolFee':
					return 100_000
				case 'feePercentage':
					return 10_000
				case 'securityPool':
					return MANAGER_ADDRESS
				case 'settlementCollateralAttoEth':
					return 0n
				default:
					throw new Error(`Unexpected read: ${request.functionName}`)
			}
		})
		const client = createMockLoaderClient({
			readContract,
			getBlock: async () => ({ number: 11_806_221n, timestamp: 0n, baseFeePerGas }),
			multicall: async () => {
				throw new Error('Unexpected multicall')
			},
		})
		const funding = await loadCoordinatorInitialReportFundingRequirement(client, MANAGER_ADDRESS, MANAGER_ADDRESS, 10n ** 18n)
		const expectedMinimum = baseFeePerGas > 0n ? 891_743_598_253_846_155n : 807_692_307_692_307_693n
		expect(funding.minimumToken1ReportAttoEth).toBe(expectedMinimum)
		expect(funding.requiredRepAttoRep).toBe(expectedMinimum)
		expect(funding.maximumInitialAttoWeth).toBe(2n * expectedMinimum)
	})
}

for (const missing of ['base fee', 'block number']) {
	test(`initial report funding stops when the ${missing} is unavailable`, async () => {
		const client = createMockLoaderClient({
			getBlock: async () => ({ timestamp: 0n, number: missing === 'block number' ? undefined : 1n, baseFeePerGas: missing === 'base fee' ? undefined : 1n }),
			multicall: async () => {
				throw new Error('Unexpected multicall')
			},
			readContract: async request => {
				if (request.functionName === 'reputationToken') return MANAGER_ADDRESS
				if (request.functionName === 'balanceOf') return 2n * 10n ** 18n
				throw new Error(`Unexpected read: ${request.functionName}`)
			},
		})
		await expect(loadCoordinatorInitialReportFundingRequirement(client, MANAGER_ADDRESS, MANAGER_ADDRESS, 10n ** 18n)).rejects.toThrow('current block fee is unavailable')
	})
}
