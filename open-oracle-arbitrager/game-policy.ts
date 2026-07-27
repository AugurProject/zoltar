import type { Address } from '@zoltar/shared/ethereum'
import { OPEN_ORACLE_FLAG_STORE_ALL, OPEN_ORACLE_FLAG_TIME_TYPE, type OpenOracleStatePreimage } from '@zoltar/shared/openOracle'

export const MAX_SAFE_CALLBACK_GAS_LIMIT = 10_000_000n
export const MAX_SAFE_SETTLEMENT_BLOCKS = 50_400n
export const MAX_SAFE_SETTLEMENT_SECONDS = 604_800n
export const MAX_SAFE_MULTIPLIER = 200n

export type CoordinatorGamePolicy = {
	callbackGasLimit: bigint
	coordinator: Address
	disputeDelay: bigint
	feePercentage: bigint
	flags: bigint
	multiplier: bigint
	openOracle: Address
	protocolFee: bigint
	protocolFeeRecipient: Address
	settlementTime: bigint
	token1: Address
	token2: Address
}

function sameAddress(left: Address, right: Address) {
	return left.toLowerCase() === right.toLowerCase()
}

function fieldMismatch(actual: bigint, expected: bigint, name: string) {
	return actual === expected ? undefined : `${name} differs from the approved coordinator template`
}

export function coordinatorPolicySafetyMismatch(policy: CoordinatorGamePolicy) {
	if ((policy.flags & OPEN_ORACLE_FLAG_STORE_ALL) === 0n) return 'Stored OpenOracle state is required for durable lifecycle recovery'
	if (policy.callbackGasLimit > MAX_SAFE_CALLBACK_GAS_LIMIT) return 'Callback gas limit exceeds the arbitrager safety bound'
	const maximumSettlementTime = (policy.flags & OPEN_ORACLE_FLAG_TIME_TYPE) === 0n ? MAX_SAFE_SETTLEMENT_BLOCKS : MAX_SAFE_SETTLEMENT_SECONDS
	if (policy.settlementTime > maximumSettlementTime) return 'Settlement time exceeds the arbitrager safety bound'
	if (policy.multiplier > MAX_SAFE_MULTIPLIER) return 'Multiplier exceeds the arbitrager safety bound'
	return undefined
}

export function gamePolicyMismatch(report: OpenOracleStatePreimage, policies: readonly CoordinatorGamePolicy[], expectedOpenOracle: Address) {
	const policy = policies.find(candidate => sameAddress(candidate.coordinator, report.helper.creator))
	if (policy === undefined) return 'Report creator is not an approved coordinator'
	if (!sameAddress(policy.openOracle, expectedOpenOracle)) return 'Coordinator is bound to a different OpenOracle'
	const game = report.game
	if (!sameAddress(game.callbackContract, policy.coordinator)) return 'Settlement callback is not the report coordinator'
	if (!sameAddress(game.token1, policy.token1) || !sameAddress(game.token2, policy.token2)) return 'Token pair differs from the approved coordinator template'
	if (!sameAddress(game.protocolFeeRecipient, policy.protocolFeeRecipient)) return 'Protocol fee recipient differs from the approved coordinator template'
	const mismatch =
		fieldMismatch(game.callbackGasLimit, policy.callbackGasLimit, 'Callback gas limit') ??
		fieldMismatch(game.settlementTime, policy.settlementTime, 'Settlement time') ??
		fieldMismatch(game.disputeDelay, policy.disputeDelay, 'Dispute delay') ??
		fieldMismatch(game.feePercentage, policy.feePercentage, 'Fee percentage') ??
		fieldMismatch(game.protocolFee, policy.protocolFee, 'Protocol fee') ??
		fieldMismatch(game.multiplier, policy.multiplier, 'Multiplier') ??
		fieldMismatch(game.flags, policy.flags, 'Flags')
	if (mismatch !== undefined) return mismatch
	return coordinatorPolicySafetyMismatch(policy)
}

export function retainedReportIds(reports: ReadonlyMap<bigint, { latest: OpenOracleStatePreimage }>, policies: readonly CoordinatorGamePolicy[], expectedOpenOracle: Address, maximumUntrustedReports: number) {
	const trustedIds = [...reports.entries()].filter(([, report]) => gamePolicyMismatch(report.latest, policies, expectedOpenOracle) === undefined).map(([id]) => id)
	if (policies.length !== 0) return new Set(trustedIds)
	const newestFirst = (left: bigint, right: bigint) => {
		if (left > right) return -1
		if (left < right) return 1
		return 0
	}
	return new Set([...reports.keys()].sort(newestFirst).slice(0, maximumUntrustedReports))
}
