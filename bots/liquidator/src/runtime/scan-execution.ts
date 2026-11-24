import { executePendingSecurityPoolReport } from '#execution/security-pool-report'
import { totalManagedPrincipalAttoRep } from '#core/security-pool-exposure'
import { executeUnusedSecurityPoolFunding, unusedSecurityPoolFunding } from '#execution/security-pool-unused-funding'
import { executeSecurityPoolInstruction } from '#execution/security-pool-instructions'
import { securityPoolTakeoverPlan } from '#core/security-pool-strategy'
import { SecurityPoolGasBudgetExceeded, SecurityPoolOpportunityExpired, executeSecurityPoolTakeover } from '#execution/security-pool-executor'
import type { SecurityPoolInstruction } from '#config/security-pool-instructions'
import { executeSecurityPoolEarnings } from '#execution/security-pool-earnings'
import { securityPoolEarningsCoverGas } from '#core/security-pool-earnings'
import { securityPoolTarget } from '#monitoring/security-pool-auction'
import type { SecurityPoolObservation } from '#monitoring/security-pool-monitor'
import type { RuntimeState } from '#state/operator-state'
import { recordActivity } from '#state/operator-state'
import { canonicalMarketPriceAllowsExecution, marketPriceAllowsExecution } from '#core/candidate-selection'
import { shouldStopAfterSuccessfulCycle } from '#core/cycle-control'
import { recoverPendingTransactions } from '#execution/recovery'
import { canonicalBlockHash } from '#monitoring/operator-chain'
import { saveDurableState } from '#state/operator-state'
import { requireCurrentDexEvidence } from './dex-pairs.ts'
import type { LiquidatorDeps, LiquidatorRuntime } from './liquidator-runtime.ts'

/** Recovers pending transactions, then performs at most one funded security pool action. */
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
	const instructionExecuted = await executeQueuedSecurityPoolInstructions(state, runtime.settings.securityPoolInstructions ?? [], instruction =>
		executeSecurityPoolInstruction(activeWallet, runtime.settings, state, runtime.readPool, instruction, current => canonicalMarketPriceAllowsExecution({ repToken: current.snapshot.repToken, lastPrice: current.snapshot.acceptedPrice }, runtime.settings, state, canonicalHash, requireDexEvidence)),
	)
	if (instructionExecuted) return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
	if (
		await executeSecurityPoolAutomation(runtime, state, current =>
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
export async function executeQueuedSecurityPoolInstructions(state: RuntimeState, instructions: readonly SecurityPoolInstruction[], execute: (instruction: SecurityPoolInstruction) => Promise<boolean>) {
	for (const instruction of instructions) {
		try {
			if (await execute(instruction)) return true
		} catch (error) {
			if (!(error instanceof SecurityPoolOpportunityExpired) || state.pendingTransactions.length !== 0) throw error
			recordActivity(state, { kind: 'liquidation', status: 'info', message: `Security pool instruction ${instruction.id} deferred; retry next cycle`, details: error.message })
		}
	}
	return false
}

/** @internal Waiting candidates reserve only their own security pool; a submission ends the cycle. */
export async function executeSecurityPoolAutomation(
	runtime: Pick<LiquidatorRuntime, 'wallet' | 'settings' | 'readPool'>,
	state: RuntimeState,
	priceAllowsExecution: (observation: SecurityPoolObservation) => Promise<boolean>,
	execution = { pendingReport: executePendingSecurityPoolReport, earnings: executeSecurityPoolEarnings, takeover: executeSecurityPoolTakeover, unusedFunding: executeUnusedSecurityPoolFunding },
) {
	const activeWallet = runtime.wallet
	if (activeWallet === undefined) throw new Error('Live execution requires an active signer')
	const waiting = new Set<SecurityPoolObservation>()
	if (runtime.settings.securityPoolPolicy.allowFundedTakeovers) {
		const totalPrincipal = totalManagedPrincipalAttoRep(state.securityPools)
		for (const securityPool of state.securityPools) {
			const pending = await execution.pendingReport(activeWallet, runtime.settings, state, runtime.readPool, securityPool).catch(error => {
				if (!(error instanceof SecurityPoolGasBudgetExceeded) || state.pendingTransactions.length !== 0) throw error
				recordActivity(state, { kind: 'liquidation', status: 'info', message: error.message })
				return 'waiting' as const
			})
			if (pending === 'submitted') return true
			if (pending === 'waiting') {
				waiting.add(securityPool)
				continue
			}
			const price = { repToken: securityPool.snapshot.repToken, lastPrice: securityPool.snapshot.acceptedPrice }
			const priceAllowed = priceAllowsExecution
			if (securityPoolEarningsCoverGas(securityPool, runtime.settings, marketPriceAllowsExecution(price, runtime.settings, state))) {
				try {
					await execution.earnings(activeWallet, runtime.settings, state, runtime.readPool, securityPool, priceAllowed)
					return true
				} catch (error) {
					if (!(error instanceof SecurityPoolGasBudgetExceeded) || state.pendingTransactions.length !== 0) throw error
					recordActivity(state, { kind: 'fees', status: 'info', message: error.message })
				}
			}
			for (const position of securityPool.positions) {
				const marketAllowed = marketPriceAllowsExecution(price, runtime.settings, state, !securityPool.snapshot.priceValid || securityPool.snapshot.timestamp >= securityPool.snapshot.priceValidUntil)
				const { plan } = securityPoolTakeoverPlan(securityPool, position, runtime.settings, totalPrincipal, marketAllowed)
				if (plan === undefined) continue
				await execution.takeover(activeWallet, runtime.settings, state, runtime.readPool, securityPool, securityPoolTarget(position), priceAllowed, undefined, plan.unlockedTarget)
				return true
			}
		}
	}
	for (const securityPool of state.securityPools) {
		if (waiting.has(securityPool) || unusedSecurityPoolFunding(state, securityPool).amount === 0n) continue
		const executed = await execution.unusedFunding(activeWallet, runtime.settings, state, runtime.readPool, securityPool, priceAllowsExecution)
		if (executed) return true
	}
	return false
}

/** Records the best dry-run candidate once per distinct pool, target, debt, and price. */
export function runDryRunStep(runtime: LiquidatorRuntime, deps: LiquidatorDeps) {
	const { state } = deps
	const totalPrincipal = totalManagedPrincipalAttoRep(state.securityPools)
	for (const securityPool of state.securityPools) {
		for (const position of securityPool.positions) {
			const marketAllowed = marketPriceAllowsExecution({ repToken: securityPool.snapshot.repToken, lastPrice: securityPool.snapshot.acceptedPrice }, runtime.settings, state, !securityPool.snapshot.priceValid || securityPool.snapshot.timestamp >= securityPool.snapshot.priceValidUntil)
			const result = securityPoolTakeoverPlan(securityPool, position, runtime.settings, totalPrincipal, marketAllowed)
			if (result.plan === undefined) continue
			const label = position.auctionTarget === undefined ? `position=${position.id}` : `auction=${position.auctionTarget.auction} bid=${position.auctionTarget.bidId}`
			const key = `securityPool:${securityPool.snapshot.capitalLedger}:${label}:${position.commitment}:${securityPool.acceptedPriceEpoch}`
			if (runtime.lastDryRunKey !== key)
				recordActivity(state, {
					kind: 'liquidation',
					status: 'dry-run',
					message: 'Security pool funded takeover candidate',
					details: `${securityPool.selection.address} universe=${securityPool.selection.universeId} ${label} ownREP=${result.plan.ownFunding}; ${result.reason}`,
				})
			runtime.lastDryRunKey = key
			return
		}
	}
}
