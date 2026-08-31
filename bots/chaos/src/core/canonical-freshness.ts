import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'

export const MAXIMUM_CANONICAL_HEAD_LAG_BLOCKS = 64n
export const MAXIMUM_CANONICAL_ANCHOR_AGE_SECONDS = 15n * 60n
export const MAXIMUM_CANONICAL_FUTURE_DRIFT_SECONDS = 2n * 60n

function currentTimestampSeconds(nowMilliseconds: number) {
	if (!Number.isSafeInteger(nowMilliseconds) || nowMilliseconds < 0) {
		throw new Error('Canonical anchor clock must be a non-negative integer millisecond timestamp')
	}
	return BigInt(Math.floor(nowMilliseconds / 1_000))
}

export function assertCanonicalAnchorFreshness(heads: readonly bigint[], anchorBlockNumber: bigint, anchorTimestamp: bigint, nowMilliseconds = Date.now()) {
	if (heads.length === 0) throw new ConnectivityDegradedError('Canonical anchor freshness requires at least one available RPC head')
	const newestHead = heads.reduce((newest, head) => (head > newest ? head : newest))
	if (anchorBlockNumber > newestHead) throw new Error('Canonical anchor cannot be ahead of every observed RPC head')
	const headLag = newestHead - anchorBlockNumber
	if (headLag > MAXIMUM_CANONICAL_HEAD_LAG_BLOCKS) {
		throw new ConnectivityDegradedError(`Canonical anchor block ${anchorBlockNumber.toString()} is ${headLag.toString()} blocks behind the newest available RPC head, exceeding the ${MAXIMUM_CANONICAL_HEAD_LAG_BLOCKS.toString()}-block safety limit`)
	}
	const now = currentTimestampSeconds(nowMilliseconds)
	if (anchorTimestamp > now + MAXIMUM_CANONICAL_FUTURE_DRIFT_SECONDS) {
		throw new ConnectivityDegradedError(`Canonical anchor timestamp ${anchorTimestamp.toString()} is too far ahead of the operator clock`)
	}
	const age = now > anchorTimestamp ? now - anchorTimestamp : 0n
	if (age > MAXIMUM_CANONICAL_ANCHOR_AGE_SECONDS) {
		throw new ConnectivityDegradedError(`Canonical anchor timestamp is ${age.toString()} seconds old, exceeding the ${MAXIMUM_CANONICAL_ANCHOR_AGE_SECONDS.toString()}-second safety limit`)
	}
}
