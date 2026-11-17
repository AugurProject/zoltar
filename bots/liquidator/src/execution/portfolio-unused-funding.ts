import { assertPortfolioReportFunding } from './portfolio-report.ts'
import type { OperatorSettings } from '#config/settings'
import { portfolioReportTakeoverPlan } from '#core/portfolio-report-strategy'
import { portfolioTakeoverPlan } from '#core/portfolio-strategy'
import type { PortfolioObservation } from '#monitoring/portfolio-monitor'
import type { RuntimeState } from '#state/operator-state'
import { buildPortfolioCapitalWithdrawPrincipalRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { Account, Chain, Transport, WalletClient, createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { PortfolioOpportunityExpired, refreshPortfolioExecution } from './portfolio-executor.ts'
import { submitCall } from './submit-call.ts'

/**
 * Types used throughout this module.
 */
type Wallet = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>

/**
 * Compute the amount of *unused* funding that can be safely withdrawn from a portfolio.
 *
 * The original implementation ignored the `holdingFeeAttoRep` field that can be present on the
 * portfolio snapshot. When a portfolio is subject to a holding fee, the free amount of REP that can
 * be withdrawn is reduced by that fee. Failing to account for it caused the liquidator to think the
 * unused commitment was zero, which in turn made it pause on the first distressed position whose
 * deficit exceeded the (incorrectly calculated) unused commitment.
 *
 * This function now:
 *   1. Determines the tracked funding amount (`tracked`).
 *   2. Calculates the maximum withdrawable amount based on the owner's free REP and withdrawable REP.
 *   3. Subtracts any `holdingFeeAttoRep` from the withdrawable amount (clamping at zero).
 *   4. Returns the minimum of the tracked amount and the fee‑adjusted withdrawable amount.
 *
 * If there is a pending operation report or the portfolio is already being sponsored, the function
 * returns `0n` because the funding is considered "in use".
 */
export function unusedPortfolioFunding(
  state: Pick<RuntimeState, 'portfolioFunding' | 'sponsoredReports'>,
  observation: PortfolioObservation
) {
  const snapshot = observation.snapshot
  const key = `${snapshot.capitalLedger.toLowerCase()}:${snapshot.owner.toLowerCase()}`
  const funding = state.portfolioFunding?.[key]
  const tracked = funding?.amount ?? 0n

  // If there is a pending operation report or the portfolio is already part of a sponsored report,
  // we treat the funding as unavailable for withdrawal.
  const hasPendingOperation = observation.pendingOperationReport !== undefined
  const isSponsored = state.sponsoredReports?.some(report => report.fundingKey === key) ?? false

  if (hasPendingOperation || isSponsored) {
    return { key, amount: 0n, target: funding?.target }
  }

  // Compute the raw withdrawable amount based on the owner's free REP and the withdrawable REP.
  const rawWithdrawable = [tracked, snapshot.ownerAccount.freeAttoRep, snapshot.withdrawableAttoRep]
    .reduce((a, b) => (a < b ? a : b))

  // Adjust for any holding fee that reduces the amount that can actually be taken out.
  const holdingFee = snapshot.holdingFeeAttoRep ?? 0n
  const feeAdjusted = rawWithdrawable > holdingFee ? rawWithdrawable - holdingFee : 0n

  return { key, amount: feeAdjusted, target: funding?.target }
}

/** Return only journaled bot funding that is still free and has no viable takeover in this scan. */
export async function executeUnusedPortfolioFunding(
  wallet: Wallet,
  settings: OperatorSettings,
  state: RuntimeState,
  pool: RpcPool,
  target: PortfolioObservation,
  priceAllowed: (observation: PortfolioObservation) => Promise<boolean>,
  execution = { refresh: refreshPortfolioExecution, submit: submitCall }
) {
  if (!settings.runtime.execute || state.pendingTransactions.length !== 0) {
    throw new Error('Pending recovery blocks unused funding withdrawal')
  }

  const original = unusedPortfolioFunding(state, target)
  if (original.amount === 0n || original.target === undefined) return false

  const refresh = async () => {
    const current = await execution.refresh(wallet, settings, state.portfolioScopes, pool, target, undefined)
    const amount = unusedPortfolioFunding(state, current.observation)
    if (amount.key !== original.key || amount.amount < original.amount) {
      throw new PortfolioOpportunityExpired('Unused funding is no longer free and withdrawable')
    }
    if (current.observation.walletAttoEth < settings.strategy.maximumGasCostAttoEth + settings.portfolioPolicy.walletReserveAttoEth) {
      throw new PortfolioOpportunityExpired('Unused funding withdrawal would consume the gas reserve')
    }
    const marketAllowed = await priceAllowed(current.observation)
    if (!marketAllowed) throw new PortfolioOpportunityExpired('Wait for independent pricing before abandoning funded takeover')
    const candidate = await execution.refresh(wallet, settings, state.portfolioScopes, pool, target, original.target)
    for (const fresh of candidate.observation.positions) {
      if (portfolioTakeoverPlan(candidate.observation, fresh, settings, candidate.totalPrincipal, marketAllowed).plan !== undefined) {
        throw new PortfolioOpportunityExpired('The funded takeover is still viable')
      }
      const report = portfolioReportTakeoverPlan(candidate.observation, fresh, settings, candidate.totalPrincipal, marketAllowed)
      if (report.plan === undefined) continue
      try {
        assertPortfolioReportFunding({ ...candidate, plan: report.plan, reportPlans: report.plans }, settings)
      } catch (error) {
        if (error instanceof PortfolioOpportunityExpired) continue
        throw error
      }
      throw new PortfolioOpportunityExpired('The funded takeover is still viable')
    }
  }

  await refresh()
  await execution.submit(
    wallet,
    settings,
    state,
    pool,
    {
      ...buildPortfolioCapitalWithdrawPrincipalRequest({
        portfolioKey: original.key,
        amount: original.amount,
        target: original.target!
      })
    }
  )
  return true
}
