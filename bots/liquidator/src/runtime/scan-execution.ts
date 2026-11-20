import { executePendingPortfolioReport } from '#execution/portfolio-report'
import { totalManagedPrincipalAttoRep } from '#core/portfolio-exposure'
import { executeUnusedPortfolioFunding, unusedPortfolioFunding } from '#execution/portfolio-unused-funding'
import { executePortfolioInstruction } from '#execution/portfolio-instructions'
import { portfolioTakeoverPlan } from '#core/portfolio-strategy'
import { PortfolioOpportunityExpired, executePortfolioTakeover } from '#execution/portfolio-executor'
import type { PortfolioInstruction } from '#config/portfolio-instructions'
import { executePortfolioEarnings } from '#execution/portfolio-earnings'
import { portfolioEarningsCoverGas } from '#core/portfolio-earnings'
import { portfolioTarget } from '#monitoring/portfolio-auction'
import type { PortfolioObservation } from '#monitoring/portfolio-monitor'
import type { RuntimeState } from '#state/operator-state'
import { recordActivity } from '#state/operator-state'
import { canonicalMarketPriceAllowsExecution, marketPriceAllowsExecution } from '#core/candidate-selection'
import { shouldStopAfterSuccessfulCycle } from '#core/cycle-control'
import { recoverPendingTransactions } from '#execution/recovery'
import { canonicalBlockHash } from '#monitoring/operator-chain'
import { saveDurableState } from '#state/operator-state'
import { requireCurrentDexEvidence } from './dex-pairs.ts'
import type { LiquidatorDeps, LiquidatorRuntime } from './liquidator-runtime.ts'

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
	const instructionExecuted = await executeQueuedPortfolioInstructions(state, runtime.settings.portfolioInstructions ?? [], instruction =>
		executePortfolioInstruction(activeWallet, runtime.settings, state, runtime.readPool, instruction, current => canonicalMarketPriceAllowsExecution({ repToken: current.snapshot.repToken, lastPrice: current.snapshot.acceptedPrice }, runtime.settings, state, canonicalHash, requireDexEvidence)),
	)
	if (instructionExecuted) return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
	if (
		await executePortfolioAutomation(runtime, state, current =>
			canonicalMarketPriceAllowsExecution({ repToken: current.snapshot.repToken, lastPrice: current.snapshot.acceptedPrice }, runtime.settings, state, canonicalHash, requireDexEvidence, !current.snapshot.priceValid || current.snapshot.timestamp >= current.snapshot.priceValidUntil),
		)
	) {
		await saveDurableState(runtime.settings.runtime.stateFile, state)
		return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
	}
	return undefined
}

/**
 * @internal Runs queued instructions in order and stops at the first submission. An instruction whose
 * opportunity has expired stays queued without blocking later instructions or automation.
 */
export async function executeQueuedPortfolioInstructions(state: RuntimeState, instructions: readonly PortfolioInstruction[], execute: (instruction: PortfolioInstruction) => Promise<boolean>) {
	for (const instruction of instructions) {
		try {
			if (await execute(instruction)) return true
		} catch (error) {
			if (!(error instanceof PortfolioOpportunityExpired) || state.pendingTransactions.length !== 0) throw error
			recordActivity(state, { kind: 'liquidation', status: 'info', message: `Portfolio instruction ${instruction.id} deferred; retry next cycle`, details: error.message })
		}
	}
	return false
}

/** @internal Waiting candidates reserve only their own portfolio; a submission ends the cycle. */
export async function executePortfolioAutomation(
	runtime: Pick<LiquidatorRuntime, 'wallet' | 'settings' | 'readPool'>,
	state: RuntimeState,
	priceAllowsExecution: (observation: PortfolioObservation) => Promise<boolean>,
	execution = { pendingReport: executePendingPortfolioReport, earnings: executePortfolioEarnings, takeover: executePortfolioTakeover, unusedFunding: executeUnusedPortfolioFunding },
) {
	const activeWallet = runtime.wallet
	if (activeWallet === undefined) throw new Error('Live execution requires an active signer')
	const waiting = new Set<PortfolioObservation>()
	if (runtime.settings.portfolioPolicy.allowFundedTakeovers) {
		const totalPrincipal = totalManagedPrincipalAttoRep(state.portfolios)
		for (const portfolio of state.portfolios) {
			const pending = await execution.pendingReport(activeWallet, runtime.settings, state, runtime.readPool, portfolio)
			if (pending === 'submitted') return true
			if (pending === 'waiting') {
				waiting.add(portfolio)
				continue
			}
			const price = { repToken: portfolio.snapshot.repToken, lastPrice: portfolio.snapshot.acceptedPrice }
			const priceAllowed = priceAllowsExecution
			if (portfolioEarningsCoverGas(portfolio, runtime.settings, marketPriceAllowsExecution(price, runtime.settings, state))) {
				await execution.earnings(activeWallet, runtime.settings, state, runtime.readPool, portfolio, priceAllowed)
				return true
			}
			for (const position of portfolio.positions) {
				const marketAllowed = marketPriceAllowsExecution(price, runtime.settings, state, !portfolio.snapshot.priceValid || portfolio.snapshot.timestamp >= portfolio.snapshot.priceValidUntil)
				if (portfolioTakeoverPlan(portfolio, position, runtime.settings, totalPrincipal, marketAllowed).plan === undefined) continue
				await execution.takeover(activeWallet, runtime.settings, state, runtime.readPool, portfolio, portfolioTarget(position), priceAllowed)
				return true
			}
		}
	}
	for (const portfolio of state.portfolios) {
		if (waiting.has(portfolio) || unusedPortfolioFunding(state, portfolio).amount === 0n) continue
		const executed = await execution.unusedFunding(activeWallet, runtime.settings, state, runtime.readPool, portfolio, priceAllowsExecution)
		if (executed) return true
	}
	return false
}

/** Records the best dry-run candidate once per distinct pool, target, debt, and price. */
export function runDryRunStep(runtime: LiquidatorRuntime, deps: LiquidatorDeps) {
	const { state } = deps
	const totalPrincipal = totalManagedPrincipalAttoRep(state.portfolios)
	for (const portfolio of state.portfolios) {
		for (const position of portfolio.positions) {
			const marketAllowed = marketPriceAllowsExecution({ repToken: portfolio.snapshot.repToken, lastPrice: portfolio.snapshot.acceptedPrice }, runtime.settings, state, !portfolio.snapshot.priceValid || portfolio.snapshot.timestamp >= portfolio.snapshot.priceValidUntil)
			const result = portfolioTakeoverPlan(portfolio, position, runtime.settings, totalPrincipal, marketAllowed)
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
