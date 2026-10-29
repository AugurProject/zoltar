import { getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { getOpenOracleGameTuple, hashOpenOracleStatePreimage, OPEN_ORACLE_FLAG_STORE_ALL, OPEN_ORACLE_FLAG_TRACK_DISPUTES, OPEN_ORACLE_FLAG_TIME_TYPE, type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { loadPortfolioForkSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { createMockReadClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { portfolioReadClient } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { capitalClient } from './capitalClient.js'
import { capitalSnapshot, owner, portfolio, token, unit } from './capitalFixture.js'

export const priceFeed = getAddress('0x0000000000000000000000000000000000000081')
export const priceWeth = getAddress('0x0000000000000000000000000000000000000082')
export const priceOracle = getAddress('0x0000000000000000000000000000000000000083')
export const priceEscrow = getAddress('0x0000000000000000000000000000000000000084')
export function priceFixture() {
	const source = capitalClient(capitalSnapshot({ forkTime: 100n }))
	const values: Record<string, unknown> = {
		getForkChoiceDeadline: 500n,
		getForkRecapitalizationDeadline: 3_000n,
		forks: [100n * unit, 20n * unit, 10n * unit, 10n * unit, 2n * unit, 0n, 0n, 0n, true, false, true],
		choices: [1n, true],
		getChildUniverseId: 42n,
		branches: [0n, 1n, 0n, 0n, 0n, 100n * unit, true, true, false],
		seedPool: token,
		getQuestions: [123n],
		getPool: token,
		getSecurityPoolPortfolio: portfolio,
		getSecurityPoolOriginId: `0x${'11'.repeat(32)}`,
		getSecurityPool: token,
		priceFeed,
		sharedPriceFeeds: priceFeed,
		isPriceReportingOpen: true,
		reputationToken: token,
		weth: priceWeth,
		openOracle: priceOracle,
		minimumToken1ReportAttoEth: 2n * unit,
		minimumToken2ReportAttoRep: 0n,
		getRequestPriceCostAttoEth: 101n,
		lastPrice: unit,
		lastSettlementTimestamp: 800n,
		priceValidityWindowSeconds: 600n,
		settlementTime: 300n,
		pendingReportId: 0n,
		reportCandidates: [priceEscrow, owner, priceFeed, 1n, 10n, 1n],
		reportOutcome: 0n,
		feed: priceFeed,
		sponsor: owner,
	}
	const scoped = new Map<string, unknown>()
	let wethBalanceAttoEth = 0n
	let wethAllowanceAttoEth = 0n
	let repAllowanceAttoRep = 0n
	const game: OpenOracleStatePreimage['game'] = {
		callbackContract: priceEscrow,
		callbackGasLimit: 1_000_000n,
		currentAmount1: 2n * unit,
		currentAmount2: 4n * unit,
		currentReporter: priceEscrow,
		disputeDelay: 0n,
		escalationHalt: 0n,
		feePercentage: 0n,
		flags: OPEN_ORACLE_FLAG_TIME_TYPE | OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_TRACK_DISPUTES,
		lastReportOppoTime: 1n,
		multiplier: 100n,
		numReports: 1n,
		protocolFee: 0n,
		protocolFeeRecipient: zeroAddress,
		reportTimestamp: 800n,
		settlementTime: 300n,
		settlementTimestamp: 0n,
		settlerRewardAttoEth: 101n,
		token1: priceWeth,
		token2: token,
	}
	const reads: { functionName: string; blockNumber?: bigint | undefined; address: Address; args?: readonly unknown[] | undefined }[] = []
	const client = source.client.extend(() =>
		createMockReadClient(async request => {
			reads.push(request)
			const override = `${request.address}:${request.functionName}`
			if (scoped.has(override)) return scoped.get(override)
			if (request.functionName === 'securityPoolFactory') return source.client.readContract({ ...request, address: portfolio, functionName: 'factory' })
			if (request.functionName === 'universeId') return request.address === priceFeed ? 42n : 0n
			if (request.functionName === 'balanceOf' && request.address === priceWeth) return wethBalanceAttoEth
			if (request.functionName === 'allowance') return request.address === priceWeth ? wethAllowanceAttoEth : repAllowanceAttoRep
			if (request.functionName === 'reportId') return 9n
			if (request.functionName === 'tokenHolder') return request.args?.[1] === priceWeth ? 2n * unit + 1n : 4n * unit + 1n
			const id = typeof request.args?.[0] === 'bigint' ? request.args[0] : 9n
			const preimage = { game, helper: { creator: priceEscrow, blockTimestamp: 800n, blockNumber: 8n, reportId: id } }
			if (request.functionName === 'storedGame') return getOpenOracleGameTuple(game)
			if (request.functionName === 'storedHelper') return [priceEscrow, 800n, 8n]
			if (request.functionName === 'oracleGame') return hashOpenOracleStatePreimage(preimage)
			if (request.functionName === 'disputeHistory') return [2n * unit, 4n * unit, 0n, 800n]
			if (request.functionName in values) return values[request.functionName]
			return source.client.readContract(request)
		}),
	)
	const backend = { ...source.backend, createReadClient: () => client }
	installActiveEnvironmentForTesting(backend)
	return {
		source,
		values,
		game,
		reads,
		client,
		backend,
		fork: () => loadPortfolioForkSnapshot({ client: portfolioReadClient(client), portfolio, owner, universeId: 0n, outcomeIndex: 1n }),
		setWeth: (amount: bigint) => {
			wethBalanceAttoEth = amount
		},
		setAllowances: (weth: bigint, rep: bigint) => {
			wethAllowanceAttoEth = weth
			repAllowanceAttoRep = rep
		},
		set: (address: Address, name: string, value: unknown) => {
			scoped.set(`${address}:${name}`, value)
		},
	}
}
