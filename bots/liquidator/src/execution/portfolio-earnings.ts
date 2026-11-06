import type { OperatorSettings } from '#config/settings'
import { portfolioEarningsCoverGas } from '#core/portfolio-earnings'
import type { PortfolioObservation } from '#monitoring/portfolio-monitor'
import type { RuntimeState } from '#state/operator-state'
import { securityPoolCapitalLedgerAbi as capitalAbi } from '@zoltar/bot-shared/contracts/abi'
import { encodeFunctionData, type Account, type Chain, type Transport, type WalletClient, type createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { PortfolioOpportunityExpired, refreshPortfolioExecution } from './portfolio-executor.ts'
import { submitCall } from './submit-call.ts'

type Wallet = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>

/** Earned fees are collected separately, with no principal or commitment mutation. */
export async function executePortfolioEarnings(wallet: Wallet, settings: OperatorSettings, state: RuntimeState, pool: RpcPool, target: PortfolioObservation, priceAllowed: (observation: PortfolioObservation) => Promise<boolean>, execution = { refresh: refreshPortfolioExecution, submit: submitCall }) {
	if (!settings.portfolioPolicy.allowFundedTakeovers || !settings.runtime.execute) throw new Error('Portfolio automation is disabled')
	if (state.pendingTransactions.length !== 0 || state.pendingStagedOperations.length !== 0) throw new Error('Pending recovery blocks portfolio earnings withdrawal')
	const refresh = async () => {
		const current = await execution.refresh(wallet, settings, state.portfolioScopes, pool, target, undefined)
		const observation = current.observation
		if (!portfolioEarningsCoverGas(observation, settings, await priceAllowed(observation))) throw new PortfolioOpportunityExpired('Portfolio earnings do not cover claim gas and minimum profit')
		return observation
	}
	const current = await refresh()
	await execution.submit(
		wallet,
		settings,
		state,
		pool,
		{
			to: current.snapshot.capitalLedger,
			value: 0n,
			data: encodeFunctionData({ abi: capitalAbi, functionName: 'claimEarnings' }),
			gas: 'estimate',
			label: 'Collect portfolio earned fees',
			preSubmit: refresh,
			revalidateSimulationRevert: refresh,
			gasBudgetExceeded: () => {
				throw new PortfolioOpportunityExpired('Estimated earnings claim gas exceeds the configured budget')
			},
		},
		'fees',
	)
}
