import { useEffect, useRef, useState } from 'preact/hooks'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { getTokenApprovalResetReason } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { collateralAsset, tokenFunded } from '../../protocol/collateral.js'
import type { LiveMarket } from '../../protocol/liveMarket.js'
import type { LiveWorkflowContext } from './liveTradingTypes.js'
import { useTransactionSubmission } from './useTransactionSubmission.js'
import * as copy from '../../copy/collateral.js'

export function useCollateralFunding(market: LiveMarket, required: bigint | undefined, context: LiveWorkflowContext | undefined, enabled: boolean) {
	const asset = collateralAsset(market)
	const backend = getActiveBackend()
	const key = `${backend.id}:${context?.configuration.chainId}:${market.pool}:${asset.token}:${context?.configuration.router}:${context?.account}:${market.valuation?.timestamp}`
	const currentKey = useRef(key)
	currentKey.current = key
	const [approvalAmount, setApprovalAmount] = useState<bigint>()
	const [version, setVersion] = useState(0)
	const [loaded, setLoaded] = useState<{ key: string; backend: typeof backend; balance?: bigint; allowance?: bigint; error?: string }>()
	const applicable = tokenFunded(market)
	const transaction = useTransactionSubmission({
		operation: 'approval',
		label: copy.funding,
		account: context?.account,
		chainId: context?.configuration.chainId,
		market: market.pool,
		walletClient: context?.walletClient,
		externallyLocked: context?.externallyLocked ?? false,
		onWorkflowLockChange: locked => context?.onWorkflowLockChange(locked),
		onKnownReceipt: () => context?.onKnownReceipt(),
		failureFallback: copy.failed,
	})
	useEffect(() => {
		let current = true
		if (applicable && context?.account !== undefined) {
			const client = createConnectedReadClient()
			void Promise.all([client.readContract({ address: asset.token, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [context.account] }), client.readContract({ address: asset.token, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [context.account, context.configuration.router] })])
				.then(([balance, allowance]) => {
					if (current && getActiveBackend() === backend) setLoaded({ key, backend, balance, allowance })
				})
				.catch(error => {
					if (current) setLoaded({ key, backend, error: getErrorMessage(error, copy.failed) })
				})
		}
		return () => {
			current = false
		}
	}, [backend, key, version, applicable])
	const selected = loaded?.key === key && loaded.backend === backend ? loaded : undefined
	let balanceState: 'loading' | 'ready' | 'error' = 'loading'
	if (selected?.error !== undefined) balanceState = 'error'
	else if (selected?.balance !== undefined) balanceState = 'ready'
	let reason: string | undefined
	if (enabled && applicable) {
		if (context?.account === undefined) reason = copy.connect
		else if (selected?.error !== undefined) reason = selected.error
		else if (selected?.balance === undefined || selected.allowance === undefined) reason = copy.loading
		else if (required !== undefined && required > selected.balance) reason = copy.insufficient(asset.symbol)
		else if (required !== undefined && required > selected.allowance) reason = copy.approvalRequired
	}
	return {
		balanceState,
		asset,
		applicable,
		balance: selected?.balance,
		allowance: selected?.allowance,
		loading: selected === undefined,
		reason,
		error: transaction.error ?? selected?.error,
		readError: selected?.error,
		retry: () => setVersion(value => value + 1),
		pending: transaction.state === 'preparing' || transaction.state === 'submitting' || transaction.state === 'pending',
		resetting: approvalAmount === 0n && (transaction.state === 'preparing' || transaction.state === 'submitting' || transaction.state === 'pending'),
		approve: async (amount: bigint) => {
			if (context?.account === undefined || context.walletClient === undefined || !applicable || !enabled || transaction.workflowLocked) return
			setApprovalAmount(amount)
			const capturedKey = key
			const { account, walletClient, configuration } = context
			await transaction.submit({
				prepare: async () => {
					if (currentKey.current !== capturedKey || getActiveBackend() !== backend) throw new Error('Collateral funding context changed. Review again.')
					const allowance = await walletClient.readContract({ address: asset.token, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [account, configuration.router] })
					const resetReason = getTokenApprovalResetReason(allowance, amount, asset.symbol, asset.symbol === 'USDT')
					if (resetReason !== undefined) throw new Error(resetReason)
					return amount
				},
				send: async (approved, requestSignature) =>
					await context.createGuardedWalletWrite(
						account,
						'Wallet network changed.',
						'Wallet account changed.',
					)(async () => {
						if (currentKey.current !== capturedKey || getActiveBackend() !== backend) throw new Error('Collateral funding context changed. Review again.')
						return await requestSignature(() => walletClient.writeContract({ address: asset.token, abi: ABIS.mainnet.erc20, functionName: 'approve', args: [configuration.router, approved] }))
					}),
				afterConfirmed: async () => {
					setVersion(value => value + 1)
					await context.refresh({ background: true })
				},
			})
		},
	}
}
