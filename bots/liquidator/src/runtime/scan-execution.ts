import { totalManagedPrincipalAttoRep } from '#core/portfolio-exposure'
import { executeUnusedPortfolioFunding, unusedPortfolioFunding } from '#execution/portfolio-unused-funding'
import { executePortfolioInstruction } from '#execution/portfolio-instructions'
import { portfolioTakeoverPlan } from '#core/portfolio-strategy'
import { executePortfolioTakeover } from '#execution/portfolio-executor'
import { executePortfolioEarnings } from '#execution/portfolio-earnings'
import { portfolioEarningsCoverGas } from '#core/portfolio-earnings'
import { portfolioTarget } from '#monitoring/portfolio-auction'
import { recordActivity } from '#state/operator-state'
import { canonicalMarketPriceAllowsExecution, marketPriceAllowsExecution } from '#core/candidate-selection'
import { shouldStopAfterSuccessfulCycle } from '#core/cycle-control'
import { recoverPendingTransactions } from '#execution/recovery'
import { canonicalBlockHash } from '#monitoring/operator-chain'
import { saveDurableState } from '#state/operator-state'
import { requireCurrentDexEvidence } from './dex-pairs.ts'
import { type LiquidatorDeps, type LiquidatorRuntime } from './liquidator-runtime.ts'

/** Recovers pending transactions, then performs at most one funded portfolio action. */
export async function runLiveExecutionStep(runtime: LiquidatorRuntime, deps: LiquidatorDeps) {
	const { shutdown, state } = deps
	if (runtime.wallet === undefined) throw new Error('Live execution requires an active signer')
	const activeWallet = runtime.wallet
	if ((await recoverPendingTransactions(runtime.settings, activeWallet, state, runtime.readPool, shutdown.isRequested)) || state.pendingTransactions.length !== 0) {
		await saveDurableState(runtime.settings.runtime.stateFile, state)
		return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
	}
	if (shutdown.isRequested()) {
		await saveDurableState(runtime.settings.runtime.stateFile, state)
		return true
	}
	const canonicalHash = (blockNumber: bigint) => canonicalBlockHash(runtime.settings, blockNumber, runtime.readPool)
	const requireDexEvidence: Parameters<typeof canonicalMarketPriceAllowsExecution>[4] = (configuration, estimate) => requireCurrentDexEvidence(runtime, configuration, estimate)
	for (const instruction of runtime.settings.portfolioInstructions ?? []) {
		const executed = await executePortfolioInstruction(activeWallet, runtime.settings, state, runtime.readPool, instruction, current => canonicalMarketPriceAllowsExecution({ repToken: current.snapshot.repToken, lastPrice: current.snapshot.acceptedPrice }, runtime.settings, state, canonicalHash, requireDexEvidence))
		if (executed) return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
	}
	if (runtime.settings.portfolioPolicy.allowFundedTakeovers) {
		const totalPrincipal = totalManagedPrincipalAttoRep(state.portfolios)
		for (const portfolio of state.portfolios) {
			const price = { repToken: portfolio.snapshot.repToken, lastPrice: portfolio.snapshot.acceptedPrice }
			const priceAllowed = (current: typeof portfolio) => canonicalMarketPriceAllowsExecution({ repToken: current.snapshot.repToken, lastPrice: current.snapshot.acceptedPrice }, runtime.settings, state, canonicalHash, requireDexEvidence)
			if (portfolioEarningsCoverGas(portfolio, runtime.settings, marketPriceAllowsExecution(price, runtime.settings, state))) {
				await executePortfolioEarnings(activeWallet, runtime.settings, state, runtime.readPool, portfolio, priceAllowed)
				await saveDurableState(runtime.settings.runtime.stateFile, state)
				return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
			}
			for (const position of portfolio.positions) {
				const result = portfolioTakeoverPlan(portfolio, position, runtime.settings, totalPrincipal, marketPriceAllowsExecution(price, runtime.settings, state))
				if (result.plan === undefined) continue
				await executePortfolioTakeover(activeWallet, runtime.settings, state, runtime.readPool, portfolio, portfolioTarget(position), priceAllowed)
				await saveDurableState(runtime.settings.runtime.stateFile, state)
				return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
			}
		}
	}
	for (const portfolio of state.portfolios) {
		if (unusedPortfolioFunding(state, portfolio).amount === 0n) continue
		const executed = await executeUnusedPortfolioFunding(activeWallet, runtime.settings, state, runtime.readPool, portfolio, current => canonicalMarketPriceAllowsExecution({ repToken: current.snapshot.repToken, lastPrice: current.snapshot.acceptedPrice }, runtime.settings, state, canonicalHash, requireDexEvidence))
		if (executed) return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
	}
	return undefined
}

/** Records the best dry-run candidate once per distinct pool, target, debt, and price. */
export function runDryRunStep(runtime: LiquidatorRuntime, deps: LiquidatorDeps) {
	const { state } = deps
	const totalPrincipal = totalManagedPrincipalAttoRep(state.portfolios)
	for (const portfolio of state.portfolios) {
		for (const position of portfolio.positions) {
			const result = portfolioTakeoverPlan(portfolio, position, runtime.settings, totalPrincipal, marketPriceAllowsExecution({ repToken: portfolio.snapshot.repToken, lastPrice: portfolio.snapshot.acceptedPrice }, runtime.settings, state))
			if (result.plan === undefined) continue
			const label = position.auctionTarget === undefined ? `position=${position.id}` : `auction=${position.auctionTarget.auction} bid=${position.auctionTarget.bidId}`
			const key = `portfolio:${portfolio.snapshot.capitalLedger}:${label}:${position.commitment}:${portfolio.acceptedPriceEpoch}`
			if (runtime.lastDryRunKey !== key)
				recordActivity(state, {
					kind: 'liquidation',
					status: 'dry-run',
					message: 'Portfolio funded takeover candidate',
					details: `${portfolio.selection.address} universe=${portfolio.selection.universeId} ${label} ownREP=${result.plan.ownFunding}; ${result.reason}`,
				})
			runtime.lastDryRunKey = key
			return
		}
	}
}
