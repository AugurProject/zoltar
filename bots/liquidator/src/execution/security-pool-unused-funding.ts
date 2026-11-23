import type { OperatorSettings } from '#config/settings'
import { securityPoolTakeoverPlan } from '#core/security-pool-strategy'
import type { SecurityPoolObservation } from '#monitoring/security-pool-monitor'
import type { RuntimeState } from '#state/operator-state'
import { buildSecurityPoolCapitalWithdrawPrincipalRequest } from '@zoltar/statoblast-shared/statoblast/securityPool'
import type { Account, Chain, Transport, WalletClient, createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { SecurityPoolOpportunityExpired, refreshSecurityPoolExecution } from './security-pool-executor.ts'
import { submitCall } from './submit-call.ts'

type Wallet = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>

export function unusedSecurityPoolFunding(state: Pick<RuntimeState, 'securityPoolFunding'>, observation: SecurityPoolObservation) {
	const snapshot = observation.snapshot
	const key = `${snapshot.capitalLedger.toLowerCase()}:${snapshot.owner.toLowerCase()}`
	const funding = state.securityPoolFunding?.[key]
	const tracked = funding?.amount ?? 0n
	const amount = observation.pendingOperationReport === undefined ? [tracked, snapshot.ownerAccount.freeAttoRep, snapshot.withdrawableAttoRep].reduce((a, b) => (a < b ? a : b)) : 0n
	return { key, amount, target: funding?.target }
}

/** Return only journaled bot funding that is still free and has no viable takeover in this scan. */
export async function executeUnusedSecurityPoolFunding(wallet: Wallet, settings: OperatorSettings, state: RuntimeState, pool: RpcPool, target: SecurityPoolObservation, priceAllowed: (observation: SecurityPoolObservation) => Promise<boolean>, execution = { refresh: refreshSecurityPoolExecution, submit: submitCall }) {
	if (!settings.runtime.execute || state.pendingTransactions.length !== 0) throw new Error('Pending recovery blocks unused funding withdrawal')
	const original = unusedSecurityPoolFunding(state, target)
	if (original.amount === 0n || original.target === undefined) return false
	const refresh = async () => {
		const current = await execution.refresh(wallet, settings, state.securityPoolScopes, pool, target, undefined)
		const amount = unusedSecurityPoolFunding(state, current.observation)
		if (amount.key !== original.key || amount.amount < original.amount) throw new SecurityPoolOpportunityExpired('Unused funding is no longer free and withdrawable')
		if (current.observation.walletAttoEth < settings.strategy.maximumGasCostAttoEth + settings.securityPoolPolicy.walletReserveAttoEth) throw new SecurityPoolOpportunityExpired('Unused funding withdrawal would consume the gas reserve')
		const marketAllowed = await priceAllowed(current.observation)
		if (!marketAllowed) throw new SecurityPoolOpportunityExpired('Wait for independent pricing before abandoning funded takeover')
		const candidate = await execution.refresh(wallet, settings, state.securityPoolScopes, pool, target, original.target)
		for (const fresh of candidate.observation.positions) {
			if (securityPoolTakeoverPlan(candidate.observation, fresh, settings, candidate.totalPrincipal, marketAllowed).plan !== undefined) throw new SecurityPoolOpportunityExpired('The funded takeover is still viable')
		}
	}
	await refresh()
	await execution.submit(
		wallet,
		settings,
		state,
		pool,
		{
			...buildSecurityPoolCapitalWithdrawPrincipalRequest({ owner: wallet.account.address, capitalLedger: target.snapshot.capitalLedger, amountAttoRep: original.amount }),
			gas: 'estimate',
			label: 'Return unused takeover funding to operator wallet',
			securityPoolFunding: { key: original.key, operation: 'withdraw', amount: original.amount },
			preSubmit: refresh,
			revalidateSimulationRevert: refresh,
			gasBudgetExceeded: () => {
				throw new SecurityPoolOpportunityExpired('Unused funding withdrawal exceeds gas budget; retry later')
			},
		},
		'withdrawal',
	)
	return true
}
