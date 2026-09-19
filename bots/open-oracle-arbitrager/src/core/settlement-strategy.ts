import type { Address } from '@zoltar/bot-shared/ethereum'
import { OPEN_ORACLE_FLAG_TIME_TYPE, type OpenOracleGame } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import type { MutableSettlement, RewardWithdrawalDecision, SettlementDecision } from '#state/settlement-store'

/** Gas for `settle` itself: state-hash rewrite, holder credits, reward credit, events, and the callback dispatch. */
const SETTLE_BASE_GAS = 250_000n
/** Gas for one `withdraw(ETH, amount)` call, amortised into every settlement so batching the reward is priced in. */
const REWARD_WITHDRAWAL_GAS = 60_000n

/** OpenOracle forwards `callbackGasLimit` to the callback and then requires 1/63 of it to remain, so the plan carries that slack. */
function settlementGasPlan(callbackGasLimit: bigint) {
	return SETTLE_BASE_GAS + callbackGasLimit + callbackGasLimit / 63n
}

export function rewardWithdrawalGasPlan() {
	return REWARD_WITHDRAWAL_GAS
}

export type SettlementTiming = { elapsed: bigint; windowUnit: 'blocks' | 'seconds' }

/** Explains why a report is not a third-party settlement candidate at the current head, or `undefined` when it is. */
export function settlementEligibilityMismatch(game: Pick<OpenOracleGame, 'currentReporter' | 'flags' | 'reportTimestamp' | 'settlementTime' | 'settlementTimestamp'>, blockNumber: bigint, blockTimestamp: bigint, account: Address | undefined) {
	if (game.settlementTimestamp !== 0n) return 'Report is already settled'
	if (game.reportTimestamp === 0n) return 'Report has not been submitted'
	const timeType = (game.flags & OPEN_ORACLE_FLAG_TIME_TYPE) !== 0n
	const currentTime = timeType ? blockTimestamp : blockNumber
	if (currentTime < game.reportTimestamp + game.settlementTime) return 'Settlement window has not ended'
	if (account !== undefined && game.currentReporter.toLowerCase() === account.toLowerCase()) return 'Own report settles through the position lifecycle'
	return undefined
}

export function settlementTiming(game: Pick<OpenOracleGame, 'flags' | 'reportTimestamp' | 'settlementTime'>, blockNumber: bigint, blockTimestamp: bigint): SettlementTiming {
	const timeType = (game.flags & OPEN_ORACLE_FLAG_TIME_TYPE) !== 0n
	const currentTime = timeType ? blockTimestamp : blockNumber
	return { elapsed: currentTime - (game.reportTimestamp + game.settlementTime), windowUnit: timeType ? 'seconds' : 'blocks' }
}

export type SettlementEconomics = {
	gas: bigint
	netAttoEth: bigint
	projectedGasCostAttoEth: bigint
	profitable: boolean
	withinGasPriceCap: boolean
}

/** Reward minus the settle transaction and its amortised reward withdrawal at the projected gas price. */
export function settlementEconomics(parameters: { callbackGasLimit: bigint; gasPrice: bigint; rewardAttoEth: bigint; settings: Pick<MutableSettlement, 'maxGasPriceAttoEthPerGas' | 'minimumProfitAttoWeth'> }): SettlementEconomics {
	const gas = settlementGasPlan(parameters.callbackGasLimit)
	const projectedGasCostAttoEth = parameters.gasPrice * (gas + REWARD_WITHDRAWAL_GAS)
	const netAttoEth = parameters.rewardAttoEth - projectedGasCostAttoEth
	return {
		gas,
		netAttoEth,
		projectedGasCostAttoEth,
		profitable: netAttoEth >= parameters.settings.minimumProfitAttoWeth && parameters.rewardAttoEth > 0n,
		withinGasPriceCap: parameters.gasPrice <= parameters.settings.maxGasPriceAttoEthPerGas,
	}
}

/** Mirrors `opportunityDecision`: economic gates first, then operator state, so the queue explains why nothing was sent. */
export function settlementDecision(parameters: { economics: Pick<SettlementEconomics, 'profitable' | 'withinGasPriceCap'>; enabled: boolean; execute: boolean; inFlight: boolean; paused: boolean; signerReady: boolean; withinDailyGasBudget: boolean }): SettlementDecision {
	if (!parameters.economics.profitable) return 'unprofitable'
	if (!parameters.economics.withinGasPriceCap) return 'gas-price-cap'
	if (!parameters.withinDailyGasBudget) return 'risk-limit'
	if (!parameters.enabled) return 'disabled'
	if (!parameters.execute) return 'dry-run-settlement'
	if (!parameters.signerReady) return 'signer-unavailable'
	if (parameters.paused) return 'paused'
	if (parameters.inFlight) return 'in-flight'
	return 'eligible'
}

/**
 * Rewards accrue inside OpenOracle; withdraw once they cover the threshold, at a gas price under the cap, within the daily gas
 * budget, and only when the operator can actually sign: the same gate order as `settlementDecision`, so the summary row never
 * promises a withdrawal the stage will not send.
 */
export function rewardWithdrawalDecision(parameters: {
	dailyGas: { limitAttoWeth: bigint; spentAttoWeth: bigint }
	enabled: boolean
	execute: boolean
	gasPrice: bigint
	inFlight: boolean
	paused: boolean
	settings: Pick<MutableSettlement, 'maxGasPriceAttoEthPerGas' | 'rewardWithdrawThresholdAttoEth'>
	signerReady: boolean
	unclaimedRewardAttoEth: bigint | undefined
}): RewardWithdrawalDecision {
	if (parameters.unclaimedRewardAttoEth === undefined) return 'unavailable'
	if (parameters.unclaimedRewardAttoEth < parameters.settings.rewardWithdrawThresholdAttoEth) return 'below-threshold'
	if (parameters.gasPrice > parameters.settings.maxGasPriceAttoEthPerGas) return 'gas-price-cap'
	if (parameters.dailyGas.spentAttoWeth + REWARD_WITHDRAWAL_GAS * parameters.gasPrice > parameters.dailyGas.limitAttoWeth) return 'risk-limit'
	if (!parameters.enabled) return 'disabled'
	if (!parameters.execute) return 'dry-run'
	if (!parameters.signerReady) return 'signer-unavailable'
	if (parameters.paused) return 'paused'
	if (parameters.inFlight) return 'in-flight'
	return 'due'
}
