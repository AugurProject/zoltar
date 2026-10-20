import { parseAbi, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { requireBooleanValue, requireAddressValue, requireBigintValue, requireTupleValue, requireObjectValue, requireIntegerLikeValue } from './decoders.js'
import { readRequiredMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'

const abi = parseAbi([
	'function questionId() view returns(uint256)',
	'function ledger() view returns(address)',
	'function bookIds(uint248 universeId) view returns(uint64)',
	'function feeTimestamp(uint248 universeId) view returns(uint48)',
	'function isPriceValid() view returns(bool)',
	'function question(uint64 bookId,uint256 questionId) view returns((uint256 units,uint256 outcomeSupplyAttoShares,uint48 finalAfter,uint96 feeRateAttoEthPerSecond,uint48 feeStart,uint48 feeEnd,uint256 feePrincipalAttoEth) state,uint64 frozenBookId)',
	'function books(uint64 bookId) view returns(uint256 cash,uint256 units,uint256 fees,uint64 questionRoot,uint64 finalityRoot,uint64 frozenRoot,uint48 timestamp,bool isSealed,uint64 feeRateRoot,uint64 feeEndRoot,uint64 feeModeRoot,bool feesEnabled,uint48 minimumFinalAfter,uint48 feeTimeOffset)',
	'function portfolio() view returns (address)',
	'function universeId() view returns (uint248)',
	'function settlement() view returns (address)',
	'function availableMintCapacity(uint248 universeId) view returns (uint256)',
	'function totals() view returns (uint256 rep,uint256 commitment,uint256 healthy)',
	'function snapshotQuestion(address pool) view returns ((uint256 outcomeSupplyAttoShares,uint256 questionCashAttoEth,uint256 demandAttoEth,uint256 earnedFeesAttoEth,uint48 timestamp) snapshot)',
])

/** Bound native fields are caches. Read the central economic supply, including inherited outcomes. */
export async function loadCentralPortfolioQuestion(client: Pick<ReadClient, 'multicall'>, pool: Address, capital: Address, blockNumber: bigint) {
	const [portfolioValue, universeValue, totalsValue, questionIdValue, validValue] = await readRequiredMulticall(
		client,
		[
			{ address: capital, abi, functionName: 'portfolio', args: [] },
			{ address: capital, abi, functionName: 'universeId', args: [] },
			{ address: capital, abi, functionName: 'totals', args: [] },
			{ address: pool, abi, functionName: 'questionId', args: [] },
			{ address: capital, abi, functionName: 'isPriceValid', args: [] },
		],
		blockNumber,
	)
	const portfolio = requireAddressValue(portfolioValue, 'portfolio authority')
	const universeId = requireBigintValue(universeValue, 'portfolio universe')
	const totals = requireTupleValue(totalsValue, 3, 'capital totals')
	const [settlementValue, remainingValue] = await readRequiredMulticall(
		client,
		[
			{ address: portfolio, abi, functionName: 'settlement', args: [] },
			{ address: portfolio, abi, functionName: 'availableMintCapacity', args: [universeId] },
		],
		blockNumber,
	)
	const settlement = requireAddressValue(settlementValue, 'settlement engine')
	const remainingCapacity = requireBigintValue(remainingValue, 'available capacity')
	const [snapshotValue, bookValue, bookIdValue, feeTimestampValue] = await readRequiredMulticall(
		client,
		[
			{ address: settlement, abi, functionName: 'snapshotQuestion', args: [pool] },
			{ address: settlement, abi, functionName: 'ledger', args: [] },
			{ address: settlement, abi, functionName: 'bookIds', args: [universeId] },
			{ address: settlement, abi, functionName: 'feeTimestamp', args: [universeId] },
		],
		blockNumber,
	)
	const book = requireAddressValue(bookValue, 'settlement book')
	const bookId = requireBigintValue(bookIdValue, 'settlement book ID')
	const questionId = requireBigintValue(questionIdValue, 'question ID')
	const [questionValue, bookStateValue] = await readRequiredMulticall(
		client,
		[
			{ address: book, abi, functionName: 'question', args: [bookId, questionId] },
			{ address: book, abi, functionName: 'books', args: [bookId] },
		],
		blockNumber,
	)
	const question = requireTupleValue(questionValue, 2, 'question stream')
	const stream = requireObjectValue(question[0], 'question stream state')
	const state = requireTupleValue(bookStateValue, 14, 'settlement book state')
	const feeTime = BigInt(requireIntegerLikeValue(feeTimestampValue, 'native fee timestamp'))
	const feeEnd = BigInt(requireIntegerLikeValue(Reflect.get(stream, 'feeEnd'), 'native fee end'))
	const feesActive =
		requireBooleanValue(validValue, 'capital price validity') &&
		requireBooleanValue(state[11], 'fee accrual state') &&
		!requireBooleanValue(state[7], 'book fork state') &&
		requireBigintValue(state[0], 'book cash') === requireBigintValue(state[1], 'book units') &&
		requireBigintValue(question[1], 'frozen book ID') === 0n &&
		feeTime < feeEnd
	const linearFee = { rateAttoEthPerSecond: feesActive ? requireBigintValue(Reflect.get(stream, 'feeRateAttoEthPerSecond'), 'question fee rate') : 0n, endTime: feeEnd }
	const snapshot = requireObjectValue(snapshotValue, 'question settlement')
	const cash = requireBigintValue(Reflect.get(snapshot, 'questionCashAttoEth'), 'question cash')
	return {
		centralSettlement: true as const,
		settlementCollateralAttoEth: cash,
		shareTokenSupplyAttoShares: requireBigintValue(Reflect.get(snapshot, 'outcomeSupplyAttoShares'), 'economic outcome supply'),
		mintingCapacityAttoEth: cash + remainingCapacity,
		totalPoolHeldAttoRep: requireBigintValue(totals[0], 'total REP'),
		totalUnderwritingLimitAttoEth: requireBigintValue(totals[1], 'total commitment'),
		feeEligibleUnderwritingLimitAttoEth: requireBigintValue(totals[2], 'healthy commitment'),
		lastUpdatedFeeAccumulator: feeTime,
		linearFee,
		feeEndTimestamp: feeEnd,
	}
}
