import type { OperatorSettings } from '#config/settings'
import { securityPoolEarningsCoverGas } from '#core/security-pool-earnings'
import type { SecurityPoolObservation } from '#monitoring/security-pool-monitor'
import type { RuntimeState } from '#state/operator-state'
import { securityPoolCapitalLedgerAbi as capitalAbi } from '@zoltar/bot-shared/contracts/abi'
import { encodeFunctionData, type Account, type Chain, type Transport, type WalletClient, type createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { SecurityPoolGasBudgetExceeded, SecurityPoolOpportunityExpired, refreshSecurityPoolExecution } from './security-pool-executor.ts'
import { submitCall } from './submit-call.ts'

type Wallet = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>

/** Earned fees are collected separately, with no principal or commitment mutation. */
export async function executeSecurityPoolEarnings(wallet: Wallet, settings: OperatorSettings, state: RuntimeState, pool: RpcPool, target: SecurityPoolObservation, priceAllowed: (observation: SecurityPoolObservation) => Promise<boolean>, execution = { refresh: refreshSecurityPoolExecution, submit: submitCall }) {
	if (!settings.securityPoolPolicy.allowFundedTakeovers || !settings.runtime.execute) throw new Error('Security pool automation is disabled')
	if (state.pendingTransactions.length !== 0) throw new Error('Pending recovery blocks security pool earnings withdrawal')
	const refresh = async () => {
		const current = await execution.refresh(wallet, settings, state.securityPoolScopes, pool, target, undefined)
		const observation = current.observation
		if (!securityPoolEarningsCoverGas(observation, settings, await priceAllowed(observation))) throw new SecurityPoolOpportunityExpired('Security pool earnings do not cover claim gas and minimum profit')
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
			data: encodeFunctionData({ abi: capitalAbi, functionName: 'claimEarnings', args: [wallet.account.address] }),
			gas: 'estimate',
			label: 'Collect security pool earned fees',
			preSubmit: refresh,
			revalidateSimulationRevert: refresh,
			gasBudgetExceeded: () => {
				throw new SecurityPoolGasBudgetExceeded('Estimated earnings claim gas exceeds the configured budget')
			},
		},
		'fees',
	)
}
