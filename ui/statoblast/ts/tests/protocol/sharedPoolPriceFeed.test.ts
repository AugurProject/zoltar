import { expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { createReadContractStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { readCoordinatorMinimumReport } from '@zoltar/ui-statoblast-shared/protocol/oracleInitialReportFunding.js'
import { loadOracleManagerQueueOperationEthValue } from '@zoltar/ui-statoblast-shared/protocol/oracleCoordinator.js'

const coordinator = getAddress('0x0000000000000000000000000000000000000001')
const feed = getAddress('0x0000000000000000000000000000000000000002')
const otherCoordinator = getAddress('0x0000000000000000000000000000000000000003')

test('report funding covers shared exposure across questions at the pinned block', async () => {
	const readContract = createReadContractStub(async request => {
		expect(request.blockNumber).toBe(7n)
		switch (request.functionName) {
			case 'priceFeed':
				return feed
			case 'aggregateExposureAttoEth':
				expect(request.address).toBe(feed)
				return 100_000n * 10n ** 18n
			case 'securityPool':
				return coordinator
			case 'settlementCollateralAttoEth':
				return 0n
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
			default:
				throw new Error(`Unexpected read ${request.functionName}`)
		}
	})
	const client = { readContract, getBlock: async () => ({ number: 7n, timestamp: 1n, baseFeePerGas: 10n, transactions: [] }) }
	expect(await readCoordinatorMinimumReport(client, coordinator)).toBe(1000n * 10n ** 18n + 807_692_307_692_307_693n)
})

test('an unrelated question cannot join a shared report operation queue', async () => {
	const readContract = createReadContractStub(async request => {
		switch (request.functionName) {
			case 'priceFeed':
				return feed
			case 'pendingCoordinator':
				return otherCoordinator
			case 'lastPrice':
				return 0n
			case 'pendingReportId':
				return 7n
			case 'getPendingSettlementOperationIds':
				return []
			case 'MAX_PENDING_SETTLEMENT_OPERATIONS':
				return 4n
			case 'getQueuedOperationCostAttoEth':
				return 0n
			case 'getSettlementCallbackGasLimit':
				return 10
			case 'gasConsumedOpenOracleReportPrice':
				return 20n
			case 'isPriceValid':
				return false
			default:
				throw new Error(`Unexpected read ${request.functionName}`)
		}
	})
	const client = { readContract, getBlock: async () => ({ number: 7n, timestamp: 1n, baseFeePerGas: 10n, transactions: [] }) }
	await expect(loadOracleManagerQueueOperationEthValue(client, coordinator)).rejects.toThrow('Another question is refreshing the shared pool price')
})

for (const mismatch of [undefined, 'feed', 'factory', 'weth', 'rep'] as const) {
	test(`shared report freshness authenticates canonical factory registration and report tokens (${mismatch ?? 'valid'})`, async () => {
		const { createMulticallStub } = await import('@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js')
		const { loadCoordinatorPriceValidUntilTimestamp } = await import('@zoltar/ui-statoblast-shared/protocol/openOracleSettlement.js')
		const { OPEN_ORACLE_FLAG_TIME_TYPE } = await import('@zoltar/open-oracle-shared/openOracle/openOracle')
		const { getInfraContractAddresses } = await import('@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js')
		const multicall = createMulticallStub(async requests =>
			requests.contracts.map(request => {
				if (request.functionName === 'openOracle') return { status: 'success', result: otherCoordinator }
				if (request.functionName === 'securityPoolFactory') return { status: 'success', result: mismatch === 'factory' ? coordinator : getInfraContractAddresses().securityPoolFactory }
				if (request.functionName === 'portfolio') return { status: 'success', result: coordinator }
				if (request.functionName === 'universeId') return { status: 'success', result: 5n }
				if (request.functionName === 'weth') return { status: 'success', result: mismatch === 'weth' ? feed : coordinator }
				if (request.functionName === 'reputationToken') return { status: 'success', result: mismatch === 'rep' ? feed : otherCoordinator }
				if (request.functionName === 'sharedPriceFeeds') {
					expect(request.address).toBe(getInfraContractAddresses().securityPoolFactory)
					expect(request.args).toEqual([coordinator, 5n])
					return { status: 'success', result: mismatch === 'feed' ? coordinator : feed }
				}
				if (request.functionName === 'securityPool') return { status: 'failure', error: new Error('Not a question coordinator') }
				throw new Error(`Unexpected read ${request.functionName}`)
			}),
		)
		const game = {
			callbackContract: feed,
			callbackGasLimit: 1n,
			currentAmount1: 1n,
			currentAmount2: 1n,
			currentReporter: coordinator,
			disputeDelay: 1n,
			escalationHalt: 1n,
			feePercentage: 1n,
			flags: OPEN_ORACLE_FLAG_TIME_TYPE,
			lastReportOppoTime: 0n,
			multiplier: 110n,
			numReports: 1n,
			protocolFee: 0n,
			protocolFeeRecipient: coordinator,
			reportTimestamp: 100n,
			settlementTime: 60n,
			settlementTimestamp: 0n,
			settlerRewardAttoEth: 1n,
			token1: coordinator,
			token2: otherCoordinator,
		}
		const expiry = await loadCoordinatorPriceValidUntilTimestamp({ multicall }, otherCoordinator, game, 1)
		if (mismatch === undefined) expect(expiry).toBe(460n)
		else expect(expiry).toBeUndefined()
	})
}
