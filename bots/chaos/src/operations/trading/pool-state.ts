import { sameAddress } from '@zoltar/core-shared/evm/address'
import { encodeReceiveRequest } from '@zoltar/trading-shared/trading/receiveRequest'
import { inputInteger } from '../input-values.ts'
import { amount, randomDeadline } from '../planning.ts'
import { ORACLE_PRICE_VALIDITY_SECONDS, shareTokenId } from '../statoblast/planning.ts'
import { timestampDeadlineHasRequiredSafety } from '../timing.ts'
import type { EcosystemSnapshot, PairSnapshot, PlanningOptions, PoolSnapshot, ShareInventory } from '../types.ts'

export const poolForPair = (snapshot: EcosystemSnapshot, pair: PairSnapshot) => snapshot.pools.find(pool => sameAddress(pool.address, pair.pool))

export function poolQuestion(snapshot: EcosystemSnapshot, pool: PoolSnapshot) {
	return snapshot.questions.find(candidate => candidate.id === pool.questionId)
}

export function poolLifecycleOpen(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions, prerequisiteCount = 0) {
	const universe = snapshot.universes.find(candidate => candidate.id === pool.universeId)
	const question = poolQuestion(snapshot, pool)
	if (pool.systemState !== 0 || pool.awaitingForkContinuation || pool.questionOutcome !== 3 || universe?.forkTime !== '0' || question === undefined) return false
	const endTime = amount(question.endTime)
	return endTime > 0n && timestampDeadlineHasRequiredSafety(amount(snapshot.anchor.timestamp), endTime - 1n, options, prerequisiteCount)
}

function questionDeadline(snapshot: EcosystemSnapshot, pool: PoolSnapshot, seed: number) {
	const question = poolQuestion(snapshot, pool)
	if (question === undefined) return undefined
	const randomized = amount(randomDeadline(snapshot, seed))
	const protocolLastSecond = amount(question.endTime) - 1n
	return (randomized < protocolLastSecond ? randomized : protocolLastSecond).toString()
}

function oraclePriceExpiry(pool: PoolSnapshot) {
	return amount(pool.lastOracleSettlementTimestamp) + ORACLE_PRICE_VALIDITY_SECONDS
}

export function ethRouterOraclePriceIsSafe(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions) {
	return pool.oraclePriceValid && timestampDeadlineHasRequiredSafety(amount(snapshot.anchor.timestamp), oraclePriceExpiry(pool), options)
}

export function ethRouterDeadline(snapshot: EcosystemSnapshot, pool: PoolSnapshot, options: PlanningOptions, seed: number) {
	const question = questionDeadline(snapshot, pool, seed)
	if (question === undefined) return undefined
	const questionBound = BigInt(question)
	const oracleBound = oraclePriceExpiry(pool)
	const bound = questionBound < oracleBound ? questionBound : oracleBound
	const deadline = inputInteger(options, 'deadline', bound, 0n, amount(poolQuestion(snapshot, pool)?.endTime ?? '0') - 1n)
	if (deadline > oracleBound) return undefined
	return timestampDeadlineHasRequiredSafety(amount(snapshot.anchor.timestamp), deadline, options) ? deadline.toString() : undefined
}

export function protocolQuestionDeadline(snapshot: EcosystemSnapshot, pool: PoolSnapshot) {
	const question = poolQuestion(snapshot, pool)
	return question === undefined ? undefined : (amount(question.endTime) - 1n).toString()
}

export function receiveRequestData(snapshot: EcosystemSnapshot, pool: PoolSnapshot, pair: PairSnapshot, shares: ShareInventory, operation: 0 | 1, longOutcome: 1 | 2 | 3, completeAmount: bigint, maximumLong: bigint, minimumEthAttoEth: bigint, deadline: bigint) {
	const invalidTokenId = shareTokenId(shares.universeId, 0)
	return encodeReceiveRequest([
		1,
		operation,
		shares.shareToken,
		pool.address,
		pair.address,
		amount(pool.universeId),
		amount(pool.questionId),
		invalidTokenId,
		invalidTokenId | 1n,
		invalidTokenId | 2n,
		longOutcome,
		completeAmount,
		maximumLong,
		minimumEthAttoEth,
		snapshot.wallet.address,
		snapshot.wallet.address,
		deadline,
	])
}
