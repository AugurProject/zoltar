import { expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'

const coordinator = getAddress('0x0000000000000000000000000000000000000001')
const feed = getAddress('0x0000000000000000000000000000000000000002')
const otherCoordinator = getAddress('0x0000000000000000000000000000000000000003')

for (const mismatch of [undefined, 'feed', 'factory', 'weth', 'rep', 'escrow', 'report'] as const) {
	test(`shared report freshness authenticates canonical factory registration and report tokens (${mismatch ?? 'valid'})`, async () => {
		const { createMulticallStub } = await import('@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js')
		const { loadCoordinatorPriceValidUntilTimestamp } = await import('@zoltar/ui-statoblast-shared/protocol/openOracleSettlement.js')
		const { OPEN_ORACLE_FLAG_TIME_TYPE } = await import('@zoltar/open-oracle-shared/openOracle/openOracle')
		const { getInfraContractAddresses } = await import('@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js')
		const multicall = createMulticallStub(async requests =>
			requests.contracts.map(request => {
				if (request.functionName === 'feed') return { status: 'success', result: feed }
				if (request.functionName === 'reportId') return { status: 'success', result: mismatch === 'report' ? 8n : 7n }
				if (request.functionName === 'reportCandidates') return { status: 'success', result: [mismatch === 'escrow' ? feed : coordinator, coordinator, otherCoordinator, 0n] }
				if (request.functionName === 'openOracle') return { status: 'success', result: otherCoordinator }
				if (request.functionName === 'securityPoolFactory') return { status: 'success', result: mismatch === 'factory' ? coordinator : getInfraContractAddresses().securityPoolFactory }
				if (request.functionName === 'portfolio') return { status: 'success', result: coordinator }
				if (request.functionName === 'universeId') return { status: 'success', result: 5n }
				if (request.functionName === 'weth') return { status: 'success', result: mismatch === 'weth' ? feed : coordinator }
				if (request.functionName === 'reputationToken') return { status: 'success', result: mismatch === 'rep' ? feed : otherCoordinator }
				if (request.functionName === 'priceValidityWindowSeconds') return { status: 'success', result: 780n }
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
			callbackContract: coordinator,
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
		const expiry = await loadCoordinatorPriceValidUntilTimestamp({ multicall }, otherCoordinator, game, 1, 7n)
		if (mismatch === undefined) expect(expiry).toBe(940n)
		else expect(expiry).toBeUndefined()
	})
}
