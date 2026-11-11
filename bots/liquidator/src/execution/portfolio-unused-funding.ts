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

type Wallet = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>

export function unusedPortfolioFunding(state: Pick<RuntimeState, 'portfolioFunding' | 'sponsoredReports'>, observation: PortfolioObservation) {
	const snapshot = observation.snapshot
	const key = `${snapshot.capitalLedger.toLowerCase()}:${snapshot.owner.toLowerCase()}`
	const funding = state.portfolioFunding?.[key]
	const tracked = funding?.amount ?? 0n
	const amount = observation.pendingOperationReport === undefined && !state.sponsoredReports?.some(report => report.fundingKey === key) ? [tracked, snapshot.ownerAccount.freeAttoRep, snapshot.withdrawableAttoRep].reduce((a, b) => (a < b ? a : b)) : 0n
	return { key, amount, target: funding?.target }
}

/** Return only journaled bot funding that is still free and has no viable takeover in this scan. */
export async function executeUnusedPortfolioFunding(wallet: Wallet, settings: OperatorSettings, state: RuntimeState, pool: RpcPool, target: PortfolioObservation, priceAllowed: (observation: PortfolioObservation) => Promise<boolean>, execution = { refresh: refreshPortfolioExecution, submit: submitCall }) {
	if (!settings.runtime.execute || state.pendingTransactions.length !== 0 || state.pendingStagedOperations.length !== 0) throw new Error('Pending recovery blocks unused funding withdrawal')
	const original = unusedPortfolioFunding(state, target)
	if (original.amount === 0n || original.target === undefined) return false
	const refresh = async () => {
		const current = await execution.refresh(wallet, settings, state.portfolioScopes, pool, target, undefined)
		const amount = unusedPortfolioFunding(state, current.observation)
		if (amount.key !== original.key || amount.amount < original.amount) throw new PortfolioOpportunityExpired('Unused funding is no longer free and withdrawable')
		if (current.observation.walletAttoEth < settings.strategy.maximumGasCostAttoEth + settings.portfolioPolicy.walletReserveAttoEth) throw new PortfolioOpportunityExpired('Unused funding withdrawal would consume the gas reserve')
		const marketAllowed = await priceAllowed(current.observation)
		if (!marketAllowed) throw new PortfolioOpportunityExpired('Wait for independent pricing before abandoning funded takeover')
		const candidate = await execution.refresh(wallet, settings, state.portfolioScopes, pool, target, original.target)
		for (const fresh of candidate.observation.positions) {
			if (portfolioTakeoverPlan(candidate.observation, fresh, settings, candidate.totalPrincipal, marketAllowed).plan !== undefined) throw new PortfolioOpportunityExpired('The funded takeover is still viable')
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
			...buildPortfolioCapitalWithdrawPrincipalRequest({ owner: wallet.account.address, capitalLedger: target.snapshot.capitalLedger, amountAttoRep: original.amount }),
			gas: 'estimate',
			label: 'Return unused takeover funding to operator wallet',
			portfolioFunding: { key: original.key, operation: 'withdraw', amount: original.amount },
			preSubmit: refresh,
			revalidateSimulationRevert: refresh,
		},
		'withdrawal',
	)
	return true
}
