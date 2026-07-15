/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, getAddress, zeroAddress, type Address, type Hex } from '@zoltar/shared/ethereum'
import { getOpenOracleAddress, loadOracleManagerDetails, loadOpenOracleReportSummaries, settleOracleReport } from '../../protocol/index.js'
import { peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle } from '../../contractArtifact.js'
import { createBlockWithTimestamp, createMockLoaderClient, createMockWriteClient, getContractFunctionName } from './testSupport.js'

const vaultAddress = getAddress('0x00000000000000000000000000000000000000c1')
const alternateSecurityPoolAddress = getAddress('0x00000000000000000000000000000000000000a2')
const token1Address = getAddress('0x00000000000000000000000000000000000000d1')
const token2Address = getAddress('0x00000000000000000000000000000000000000d2')

describe('openOracle protocol client', () => {
	test('loadOpenOracleReportSummaries keeps reports disputed when dispute history returns to the initial reporter', async () => {
		const initialReporter = getAddress('0x00000000000000000000000000000000000000e1')
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				const contracts = request.contracts
				const firstContract = contracts[0]
				const functionName = getContractFunctionName(firstContract)
				if (functionName === 'reportMeta') {
					return [[100n, 0n, 0n, 0n, token1Address, 0, token2Address, true, 0, 0, 0, 0]]
				}
				if (functionName === 'reportStatus') {
					return [[100n, 10n, initialReporter, 1, 0, initialReporter, 0]]
				}
				if (functionName === 'extraData') {
					return [['0x0000000000000000000000000000000000000000000000000000000000000000', zeroAddress, 2, 0, zeroAddress, false]]
				}
				if (functionName === 'decimals') return [18n, 18n]
				if (functionName === 'symbol') return ['REP', 'WETH']
				throw new Error(`Unexpected multicall contract: ${functionName}`)
			},
			readContract: async request => {
				if (request.functionName === 'nextReportId') return 2n
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const page = await loadOpenOracleReportSummaries(client, 0, 10)
		const [report] = page.reports
		if (report === undefined) throw new Error('Expected one open oracle report summary')

		expect(report.currentReporter).toBe(initialReporter)
		expect(report.disputeOccurred).toBe(true)
	})

	test('loadOracleManagerDetails caps active staged operation previews and preserves the pending slot outside the preview window', async () => {
		const managerAddress = getAddress('0x00000000000000000000000000000000000000d4')
		const pendingOperationSlotId = 12n
		const previewOperationIds = Array.from({ length: 25 }, (_, index) => 40n - BigInt(index))
		let capturedActiveOperationArgs: readonly [bigint, bigint] | undefined
		const requestedFunctionNames: string[] = []
		const client = createMockLoaderClient({
			getBlock: async () => createBlockWithTimestamp(0n),
			multicall: async request => {
				for (const contract of request.contracts) {
					requestedFunctionNames.push(getContractFunctionName(contract))
				}
				return [1n, pendingOperationSlotId, [pendingOperationSlotId, 13n], 4n, 0n, 1n, 5n, true, 10n, 40n]
			},
			readContract: async request => {
				if (request.functionName === 'getActiveStagedOperations') {
					const args = request.args
					if (args === undefined) throw new Error('Expected getActiveStagedOperations args')
					const startIndex = args[0]
					const count = args[1]
					if (typeof startIndex !== 'bigint' || typeof count !== 'bigint') throw new Error('Expected bigint staged operation args')
					capturedActiveOperationArgs = [startIndex, count]
					return [
						previewOperationIds,
						previewOperationIds.map(operationId => ({
							amount: operationId,
							initiatorVault: vaultAddress,
							operation: 1,
							queuedAt: 0n,
							snapshotDenominator: 0n,
							snapshotTargetAllowance: 0n,
							snapshotTargetOwnership: 0n,
							snapshotTotalRep: 0n,
							targetVault: vaultAddress,
							validForSeconds: 60n,
						})),
					]
				}
				if (request.functionName === 'getPendingOperationSlot') {
					return {
						amount: 999n,
						initiatorVault: vaultAddress,
						operation: 0,
						queuedAt: 0n,
						snapshotDenominator: 0n,
						snapshotTargetAllowance: 0n,
						snapshotTargetOwnership: 0n,
						snapshotTotalRep: 0n,
						targetVault: alternateSecurityPoolAddress,
						validForSeconds: 60n,
					}
				}
				throw new Error(`Unexpected readContract function: ${request.functionName}`)
			},
		})

		const details = await loadOracleManagerDetails(client, managerAddress)

		expect(requestedFunctionNames).toEqual(['lastPrice', 'pendingOperationSlotId', 'getPendingSettlementOperationIds', 'MAX_PENDING_SETTLEMENT_OPERATIONS', 'pendingReportId', 'getQueuedOperationEthCost', 'getRequestPriceEthCost', 'isPriceValid', 'lastSettlementTimestamp', 'getActiveStagedOperationCount'])
		expect(capturedActiveOperationArgs).toEqual([0n, 25n])
		expect(details.activeStagedOperationCount).toBe(40n)
		expect(details.pendingOperation?.operationId).toBe(pendingOperationSlotId)
		expect(details.pendingSettlementOperationIds).toEqual([pendingOperationSlotId, 13n])
		expect(details.stagedOperations?.[0]?.operationId).toBe(40n)
		expect(details.stagedOperations?.at(-1)?.operationId).toBe(pendingOperationSlotId)
		expect(details.stagedOperations).toHaveLength(26)
	})

	test('settleOracleReport sends settle with an explicit gas limit', async () => {
		let capturedData: Hex | undefined
		let capturedGas: bigint | undefined
		let capturedTo: Address | null | undefined
		const client = createMockWriteClient(request => {
			capturedData = request.data
			capturedGas = request.gas
			capturedTo = request.to
		})

		await settleOracleReport(client, getOpenOracleAddress(), 7n)

		expect(capturedTo).toBe(getOpenOracleAddress())
		expect(capturedGas).toBe(5_000_000n)
		expect(capturedData).toBeDefined()
		const decodedCall = decodeFunctionData({
			abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
			data: capturedData ?? ('0x' satisfies Hex),
		})
		expect(decodedCall.functionName).toBe('settle')
		expect(decodedCall.args).toEqual([7n])
	})
})
