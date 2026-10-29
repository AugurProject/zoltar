import { portfolioTakeoverPlan } from '#core/portfolio-strategy'
import { executePortfolioTakeover, PortfolioOpportunityExpired } from '#execution/portfolio-executor'
import { executePortfolioCure, executePortfolioEarnings } from '#execution/portfolio-cure'
import { portfolioCurePlan } from '#core/portfolio-cure'
import { portfolioTarget } from '#monitoring/portfolio-auction'
import { recordActivity } from '#state/operator-state'
import { canonicalMarketPriceAllowsExecution, marketPriceAllowsExecution, selectedCandidate } from '#core/candidate-selection'
import { recoveryWorkBlocksExecution, shouldStopAfterSuccessfulCycle } from '#core/cycle-control'
import { selectVaultMigration } from '#core/fork-migration'
import { evaluateCandidate, liquidationExecutionAllowed } from '#core/strategy'
import { dryRunCandidate, executeLiquidation, executeOriginPoolDeployment, executeVaultMigration, maintainVault } from '#execution/liquidation-executor'
import { reconcilePendingStagedOperations, recoverPendingTransactions } from '#execution/recovery'
import { canonicalBlockHash, type desiredPoolStatus } from '#monitoring/operator-chain'
import { saveDurableState } from '#state/operator-state'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import { requireCurrentDexEvidence } from './dex-pairs.ts'
import { persistSettings, type LiquidatorDeps, type LiquidatorRuntime } from './liquidator-runtime.ts'

export type DesiredPoolStatus = Awaited<ReturnType<typeof desiredPoolStatus>>

/**
 * Performs at most one live action for the cycle, in priority order: pending recovery, origin pool deployment, vault
 * migration, vault maintenance, then liquidation. Resolves to the poll loop's stop decision, or `undefined` when the
 * cycle should fall through to its final save.
 */
export async function runLiveExecutionStep(runtime: LiquidatorRuntime, deps: LiquidatorDeps, desiredPoolStatuses: readonly DesiredPoolStatus[], scannedTimestamp: bigint) {
	const { shutdown, state } = deps
	if (runtime.wallet === undefined) throw new Error('Live execution requires an active signer')
	const activeWallet = runtime.wallet
	if (
		await recoveryWorkBlocksExecution(
			state,
			() => recoverPendingTransactions(runtime.settings, activeWallet, state, runtime.readPool, shutdown.isRequested),
			() => reconcilePendingStagedOperations(runtime.settings, activeWallet, state, runtime.readPool),
		)
	) {
		await saveDurableState(runtime.settings.runtime.stateFile, state)
		return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
	}
	if (shutdown.isRequested()) {
		await saveDurableState(runtime.settings.runtime.stateFile, state)
		return true
	}
	const missingDesiredPool = desiredPoolStatuses.find(status => status.address === getAddress('0x0000000000000000000000000000000000000000') && runtime.settings.approvedUniverses.includes(status.desired.universeId))
	if (missingDesiredPool !== undefined && runtime.settings.strategy.allowAutomaticPoolCreation) {
		await executeOriginPoolDeployment(runtime.wallet, runtime.settings, state, missingDesiredPool.desired, runtime.readPool)
		await saveDurableState(runtime.settings.runtime.stateFile, state)
		return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
	}
	const migration = selectVaultMigration(state.pools, state.universes, runtime.settings, scannedTimestamp)
	if (migration !== undefined) {
		const childPool = migration.childPool
		if (childPool !== undefined && !runtime.settings.selectedPools.some(pool => pool.toLowerCase() === childPool.address.toLowerCase())) {
			await persistSettings(runtime, deps, current => ({
				...current,
				selectedPools: [...current.selectedPools, childPool.address],
			}))
		}
		await executeVaultMigration(runtime.wallet, runtime.settings, state, migration, runtime.readPool)
		await saveDurableState(runtime.settings.runtime.stateFile, state)
		return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
	}
	const canonicalHash = (blockNumber: bigint) => canonicalBlockHash(runtime.settings, blockNumber, runtime.readPool)
	const requireDexEvidence: Parameters<typeof canonicalMarketPriceAllowsExecution>[4] = (configuration, estimate) => requireCurrentDexEvidence(runtime, configuration, estimate)
	if (runtime.settings.portfolioPolicy.allowFundedTakeovers) {
		const totalPrincipal = state.portfolios.reduce((sum, portfolio) => sum + portfolio.snapshot.ownerPrincipalAttoRep, 0n)
		for (const portfolio of state.portfolios) {
			const price = { repToken: portfolio.snapshot.repToken, lastPrice: portfolio.snapshot.acceptedPrice }
			if (portfolio.selected && portfolio.approvedUniverse && portfolio.snapshot.ownerAccount.feesAttoEth >= runtime.settings.strategy.maximumGasCostAttoEth + runtime.settings.portfolioPolicy.minimumNetRewardAttoEth) {
				await executePortfolioEarnings(activeWallet, runtime.settings, state, runtime.readPool, portfolio)
				await saveDurableState(runtime.settings.runtime.stateFile, state)
				return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
			}
			for (const position of portfolio.positions) {
				const priceAllowed = (current: typeof portfolio) => canonicalMarketPriceAllowsExecution({ repToken: current.snapshot.repToken, lastPrice: current.snapshot.acceptedPrice }, runtime.settings, state, canonicalHash, requireDexEvidence)
				if (portfolioCurePlan(portfolio, position, runtime.settings, marketPriceAllowsExecution(price, runtime.settings, state)) !== undefined) {
					try {
						await executePortfolioCure(activeWallet, runtime.settings, state, runtime.readPool, portfolio, portfolioTarget(position), priceAllowed)
						await saveDurableState(runtime.settings.runtime.stateFile, state)
						return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
					} catch (error) {
						if (!(error instanceof PortfolioOpportunityExpired)) throw error
					}
				}
				const result = portfolioTakeoverPlan(portfolio, position, runtime.settings, totalPrincipal, marketPriceAllowsExecution(price, runtime.settings, state))
				if (result.plan === undefined) continue
				await executePortfolioTakeover(activeWallet, runtime.settings, state, runtime.readPool, portfolio, portfolioTarget(position), current =>
					canonicalMarketPriceAllowsExecution({ repToken: current.snapshot.repToken, lastPrice: current.snapshot.acceptedPrice }, runtime.settings, state, canonicalHash, requireDexEvidence),
				)
				await saveDurableState(runtime.settings.runtime.stateFile, state)
				return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
			}
		}
	}
	for (const pool of state.pools) {
		if (await maintainVault(runtime.wallet, runtime.settings, state, runtime.readPool, pool, () => canonicalMarketPriceAllowsExecution(pool, runtime.settings, state, canonicalHash, requireDexEvidence))) {
			await saveDurableState(runtime.settings.runtime.stateFile, state)
			return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
		}
	}
	const selected = selectedCandidate(state.pools, runtime.settings, pool => runtime.settings.selectedPools.some(selectedPool => selectedPool.toLowerCase() === pool.address.toLowerCase()) && liquidationExecutionAllowed(pool.lastPrice, marketPriceAllowsExecution(pool, runtime.settings, state)))
	if (selected !== undefined) {
		const currentCandidate = evaluateCandidate(selected.candidate.pool, selected.candidate.target, selected.pool.botVault, runtime.settings.strategy)
		if (currentCandidate === undefined) return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
		await executeLiquidation(runtime.wallet, runtime.settings, state, runtime.readPool, selected.pool, currentCandidate, () => canonicalMarketPriceAllowsExecution(selected.pool, runtime.settings, state, canonicalHash, requireDexEvidence))
	}
	return undefined
}

/** Records the best dry-run candidate once per distinct pool, target, debt, and price. */
export function runDryRunStep(runtime: LiquidatorRuntime, deps: LiquidatorDeps) {
	const { state } = deps
	const totalPrincipal = state.portfolios.reduce((sum, portfolio) => sum + portfolio.snapshot.ownerPrincipalAttoRep, 0n)
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
					details: `${portfolio.selection.address} universe=${portfolio.selection.universeId} ${label} ownREP=${result.plan.ownFunding} reserveETH=${result.plan.reserveFunding}; ${result.reason}`,
				})
			runtime.lastDryRunKey = key
			return
		}
	}
	const selected = selectedCandidate(state.pools, runtime.settings, pool => marketPriceAllowsExecution(pool, runtime.settings, state))
	if (selected === undefined) return
	const dryRunKey = `${selected.pool.address}:${selected.candidate.target.address}:${selected.candidate.requestedDebtAttoEth.toString()}:${selected.pool.lastPrice.toString()}`
	if (dryRunKey !== runtime.lastDryRunKey) {
		dryRunCandidate(state, selected.candidate)
		runtime.lastDryRunKey = dryRunKey
	}
}
