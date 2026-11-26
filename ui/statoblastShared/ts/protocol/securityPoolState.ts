import { parseAbi, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { requireBooleanValue, requireAddressValue, requireBigintValue, requireTupleValue, requireObjectValue, requireIntegerLikeValue } from './decoders.js'
import { getMulticall3Address } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'
import { readRequiredMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'

const abi = parseAbi([
	'function refreshSecurityPoolFees()',
	'function getCurrentBlockTimestamp() view returns(uint256)',
	'function questionId() view returns(uint256)',
	'function ledger() view returns(address)',
	'function bookIds(uint248 universeId) view returns(uint64)',
	'function feeTimestamp(uint248 universeId) view returns(uint48)',
	'function isPriceValid() view returns(bool)',
	'function question(uint64 bookId,uint256 questionId) view returns((uint256 units,uint256 outcomeSupplyAttoShares,uint48 finalAfter,uint256 feeRateAttoEthPerSecond,uint48 feeStart,uint48 feeEnd,uint256 feePrincipalAttoEth) state,uint64 frozenBookId)',
	'function isCashFunded(uint64 bookId) view returns(bool)',
	'function books(uint64 bookId) view returns(uint256 cash,uint256 units,uint256 fees,uint64 questionRoot,uint64 finalityRoot,uint64 frozenRoot,uint48 timestamp,bool isSealed,uint64 feeRateRoot,uint64 feeEndRoot,uint64 feeModeRoot,bool feesEnabled,uint48 minimumFinalAfter,uint48 feeTimeOffset,uint256 finalizedUnitsPrefix,uint256 recoveryAttoRep)',
	'function securityPool() view returns (address)',
	'function universeId() view returns (uint248)',
	'function settlement() view returns (address)',
	'function availableMintCapacity(uint248 universeId) view returns (uint256)',
	'function totals() view returns (uint256 rep,uint256 commitment,uint256 healthy)',
	'function snapshotQuestion(address pool) view returns ((uint256 outcomeSupplyAttoShares,uint256 questionCashAttoEth,uint256 questionRecoveryAttoRep,uint256 demandAttoEth,uint256 earnedFeesAttoEth,uint48 timestamp) snapshot)',
])

/** Bound native fields are caches. Read the central economic supply, including inherited outcomes. */
export async function loadCentralSecurityPoolQuestion(client: Pick<ReadClient, 'multicall'>, pool: Address, capital: Address, blockNumber: bigint) {
	const [securityPoolValue, universeValue, questionIdValue] = await readRequiredMulticall(
		client,
		[
			{ address: capital, abi, functionName: 'securityPool', args: [] },
			{ address: capital, abi, functionName: 'universeId', args: [] },
			{ address: pool, abi, functionName: 'questionId', args: [] },
		],
		blockNumber,
	)
	const securityPool = requireAddressValue(securityPoolValue, 'security pool authority')
	const universeId = requireBigintValue(universeValue, 'security pool universe')
	const [settlementValue] = await readRequiredMulticall(client, [{ address: securityPool, abi, functionName: 'settlement', args: [] }], blockNumber)
	const settlement = requireAddressValue(settlementValue, 'payout contract')
	const [bookValue, bookIdValue] = await readRequiredMulticall(
		client,
		[
			{ address: settlement, abi, functionName: 'ledger', args: [] },
			{ address: settlement, abi, functionName: 'bookIds', args: [universeId] },
		],
		blockNumber,
	)
	const book = requireAddressValue(bookValue, 'payout records')
	const bookId = requireBigintValue(bookIdValue, 'payout record ID')
	const questionId = requireBigintValue(questionIdValue, 'question ID')
	const [, snapshotValue, feeTimestampValue, validValue, totalsValue, remainingValue, checkpointValue, questionValue, bookStateValue, fundedValue] = await readRequiredMulticall(
		client,
		[
			// eth_call executes this checkpoint and all dependent reads atomically, without
			// broadcasting a transaction or retaining any simulated state changes.
			{ address: pool, abi, functionName: 'refreshSecurityPoolFees', args: [] },
			{ address: settlement, abi, functionName: 'snapshotQuestion', args: [pool] },
			{ address: settlement, abi, functionName: 'feeTimestamp', args: [universeId] },
			{ address: capital, abi, functionName: 'isPriceValid', args: [] },
			{ address: capital, abi, functionName: 'totals', args: [] },
			{ address: securityPool, abi, functionName: 'availableMintCapacity', args: [universeId] },
			{ address: getMulticall3Address(), abi, functionName: 'getCurrentBlockTimestamp', args: [] },
			{ address: book, abi, functionName: 'question', args: [bookId, questionId] },
			{ address: book, abi, functionName: 'books', args: [bookId] },
			{ address: book, abi, functionName: 'isCashFunded', args: [bookId] },
		],
		blockNumber,
	)
	const totals = requireTupleValue(totalsValue, 3, 'capital totals')
	const remainingCapacity = requireBigintValue(remainingValue, 'available capacity')
	const question = requireTupleValue(questionValue, 2, 'question stream')
	const stream = requireObjectValue(question[0], 'question stream state')
	const state = requireTupleValue(bookStateValue, 16, 'payout status')
	const feeTime = BigInt(requireIntegerLikeValue(feeTimestampValue, 'native fee timestamp'))
	const feeEnd = BigInt(requireIntegerLikeValue(Reflect.get(stream, 'feeEnd'), 'native fee end'))
	const feesActive =
		requireBooleanValue(validValue, 'capital price validity') && requireBooleanValue(state[11], 'fee accrual state') && !requireBooleanValue(state[7], 'payout fork status') && requireBooleanValue(fundedValue, 'cash funding state') && requireBigintValue(question[1], 'frozen payout record ID') === 0n && feeTime < feeEnd
	const linearFee = { rateAttoEthPerSecond: feesActive ? requireBigintValue(Reflect.get(stream, 'feeRateAttoEthPerSecond'), 'question fee rate') : 0n, rateScale: 1_000_000_000n, endTime: feeEnd }
	const snapshot = requireObjectValue(snapshotValue, 'question settlement')
	const cash = requireBigintValue(Reflect.get(snapshot, 'questionCashAttoEth'), 'question cash')
	return {
		securityPoolAddress: securityPool,
		feePrincipalAttoEth: requireBigintValue(Reflect.get(stream, 'feePrincipalAttoEth'), 'holding fee base amount'),
		centralSettlement: true as const,
		centralCheckpointTimestamp: requireBigintValue(checkpointValue, 'snapshot block timestamp'),
		settlementCollateralAttoEth: cash,
		settlementRecoveryAttoRep: requireBigintValue(Reflect.get(snapshot, 'questionRecoveryAttoRep'), 'question recovery REP'),
		shareTokenSupplyAttoShares: requireBigintValue(Reflect.get(snapshot, 'outcomeSupplyAttoShares'), 'economic outcome supply'),
		mintingCapacityAttoEth: cash + remainingCapacity,
		totalPoolHeldAttoRep: requireBigintValue(totals[0], 'total REP'),
		totalUnderwritingLimitAttoEth: requireBigintValue(totals[1], 'total commitment'),
		feeEligibleUnderwritingLimitAttoEth: requireBigintValue(totals[2], 'healthy commitment'),
		lastFeeCheckpointNativeTime: feeTime,
		linearFee,
		feeEndTimestamp: feeEnd,
	}
}
