import { amount } from './planning.ts'
import { buildRouterRemovePlan, minimumAfterSlippage, poolForPair, removableLiquidityQuote } from './trading.ts'
import type { EcosystemSnapshot, PlanningOptions } from './types.ts'

export function buildRetirementLiquidityRemovalPlan(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	const pair = [...snapshot.pairs].sort((left, right) => left.address.localeCompare(right.address)).find(candidate => amount(candidate.walletLiquidity) > 0n)
	if (pair === undefined) return undefined
	const pool = poolForPair(snapshot, pair)
	const liquidity = amount(pair.walletLiquidity)
	const quote = removableLiquidityQuote(pair, liquidity)
	if (pool === undefined || quote === undefined) return undefined
	const minimumYes = minimumAfterSlippage(quote.yesOut)
	const minimumNo = minimumAfterSlippage(quote.noOut)
	const plan = buildRouterRemovePlan(snapshot, options, pair, liquidity, minimumYes, minimumNo, { liquidity: liquidity.toString(), minimumNo: minimumNo.toString(), minimumYes: minimumYes.toString(), pair: pair.address, pool: pool.address, router: snapshot.deployments.tradingRouter }, false, undefined, true)
	return plan === undefined ? undefined : { ...plan, planningSeed: options.seed }
}
