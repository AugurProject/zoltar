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
	const selected = selectedCandidate(state.pools, runtime.settings, pool => marketPriceAllowsExecution(pool, runtime.settings, state))
	if (selected === undefined) return
	const dryRunKey = `${selected.pool.address}:${selected.candidate.target.address}:${selected.candidate.requestedDebtAttoEth.toString()}:${selected.pool.lastPrice.toString()}`
	if (dryRunKey !== runtime.lastDryRunKey) {
		dryRunCandidate(state, selected.candidate)
		runtime.lastDryRunKey = dryRunKey
	}
}
