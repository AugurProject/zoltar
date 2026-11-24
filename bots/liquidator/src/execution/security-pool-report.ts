import type { OperatorSettings } from '#config/settings'
import type { RuntimeState } from '#state/operator-state'
import type { SecurityPoolObservation } from '#monitoring/security-pool-monitor'
import { sharedPoolPriceFeedAbi, openOracleAbi } from '@zoltar/bot-shared/contracts/abi'
import { encodeFunctionData, type Account, type Chain, type Transport, type WalletClient, type createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { SecurityPoolOpportunityExpired } from './security-pool-executor.ts'
import { readSecurityPoolExecutionSnapshot } from './security-pool-execution-snapshot.ts'
import { submitCall } from './submit-call.ts'

type Wallet = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>

/** Discover and settle a pending operations report sponsored by the operator wallet, such as one created by hand. */
export async function executePendingSecurityPoolReport(wallet: Wallet, settings: OperatorSettings, state: RuntimeState, pool: RpcPool, target: SecurityPoolObservation, submit = submitCall, readers?: Parameters<typeof readSecurityPoolExecutionSnapshot>[6]): Promise<'none' | 'waiting' | 'submitted'> {
	if (target.pendingOperationReport === undefined) return 'none'
	const refresh = () =>
		readSecurityPoolExecutionSnapshot(
			wallet,
			settings,
			pool,
			state.securityPoolScopes.map(scope => ({ scope, targets: [] })),
			target.selection,
			async ({ client, blockNumber }) => {
				const block = await client.getBlock({ blockNumber })
				if (block.baseFeePerGas === undefined) throw new Error('Sponsored report block has no base fee')
				return block.baseFeePerGas
			},
			readers,
		)
	const initial = await refresh()
	const current = initial.observation
	const pending = current.pendingOperationReport
	if (pending === undefined) return 'none'
	const [amount1, amount2, reporter, reportedAt, settledAt, token1, oppoTime, settlementTime, halt, recipient, bounty, token2, count, delay, fee, multiplier, callback, callbackGas, protocolFee, flags] = pending.game
	// Recovery can execute canonical operations when a candidate is rejected. Keep its
	// settlement ceiling even when the candidate's own price window has closed.
	if (initial.details > pending.maxSettlementBaseFee) return 'waiting'
	if (!current.selected || !current.approvedUniverse || !settings.runtime.execute || !settings.securityPoolPolicy.allowFundedTakeovers) return 'waiting'
	if (settledAt === 0n && current.snapshot.timestamp < reportedAt + settlementTime) return 'waiting'
	const request =
		settledAt !== 0n
			? { to: current.snapshot.priceFeed, value: 0n, data: encodeFunctionData({ abi: sharedPoolPriceFeedAbi, functionName: 'recoverReport', args: [pending.id] }) }
			: {
					to: pending.oracle,
					value: 0n,
					data: encodeFunctionData({
						abi: openOracleAbi,
						functionName: 'settle',
						args: [pending.id, [amount1, amount2, reporter, reportedAt, settledAt, token1, oppoTime, settlementTime, halt, recipient, bounty, token2, count, delay, fee, multiplier, callback, callbackGas, protocolFee, flags], [pending.id, ...pending.helper]],
					}),
				}
	const gas = settledAt !== 0n ? 'estimate' : callbackGas + callbackGas / 63n + 350_000n
	const label = settledAt === 0n ? 'Settle sponsored takeover report' : 'Recover settled sponsored report'
	const revalidate = async () => {
		const refreshed = await refresh()
		const next = refreshed.observation.pendingOperationReport
		if (next !== undefined && refreshed.details > next.maxSettlementBaseFee) throw new SecurityPoolOpportunityExpired('Report settlement base fee exceeds its ceiling')
		if (next === undefined || next.id !== pending.id || next.game.some((value, index) => value !== pending.game[index])) throw new SecurityPoolOpportunityExpired('Sponsored report changed before settlement')
	}
	if (current.walletAttoEth < settings.strategy.maximumGasCostAttoEth + settings.securityPoolPolicy.walletReserveAttoEth) throw new SecurityPoolOpportunityExpired('Report settlement would consume ETH reserve')
	await submit(
		wallet,
		settings,
		state,
		pool,
		{
			...request,
			gas,
			maxFeePerGasCap: pending.maxSettlementBaseFee,
			reportOperations: { feed: current.snapshot.priceFeed, reportId: pending.id },
			label,
			preSubmit: revalidate,
			revalidateSimulationRevert: revalidate,
			gasBudgetExceeded: () => {
				throw new SecurityPoolOpportunityExpired('Sponsored report settlement exceeds gas budget; retry later')
			},
		},
		'liquidation',
	)
	return 'submitted'
}
