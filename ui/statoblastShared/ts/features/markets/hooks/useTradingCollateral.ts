import { getTokenApprovalResetReason } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { isAddress, getAddress } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { portfolioAmountOrUndefined } from '../../portfolios/lib/draft.js'
import { loadTradingCollateral, quoteTradingCollateral } from '../../../protocol/trading.js'
import type { WriteOperationsParameters } from '../../../types/app.js'

export function useTradingCollateral({ pool, amountInput, ...parameters }: WriteOperationsParameters & { pool: string | undefined; amountInput: string; enabled: boolean }) {
	const { accountAddress, enabled, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState } = parameters
	const tradingError = useSignal<string | undefined>(undefined)
	const collateralLoaded = useSignal<{ key: string; collateral?: Awaited<ReturnType<typeof loadTradingCollateral>>; quote?: Awaited<ReturnType<typeof quoteTradingCollateral>> | undefined; error?: string }>()
	const approvalPending = useSignal(false)
	const approvalAmount = useSignal<bigint | undefined>(undefined)
	const collateralVersion = useSignal(0)
	const backend = getActiveBackend()
	const collateralPool = pool !== undefined && isAddress(pool) ? getAddress(pool) : undefined
	const collateralKey = `${backend.id}:${collateralPool}:${accountAddress}:${amountInput}:${collateralVersion.value}`
	useEffect(() => {
		let active = true
		collateralLoaded.value = undefined
		if (enabled && collateralPool !== undefined && accountAddress !== undefined)
			void (async () => {
				const client = createConnectedReadClient()
				const collateral = await loadTradingCollateral(client, collateralPool, accountAddress)
				const amount = portfolioAmountOrUndefined(amountInput, collateral.decimals)
				const quote = amount !== undefined && amount > 0n ? await quoteTradingCollateral(client, collateralPool, collateral, amount) : undefined
				if (active && getActiveBackend() === backend) collateralLoaded.value = { key: collateralKey, collateral, quote }
			})().catch(error => {
				if (active && getActiveBackend() === backend) collateralLoaded.value = { key: collateralKey, error: getErrorMessage(error, 'Unable to load collateral funding.') }
			})
		return () => {
			active = false
		}
	}, [backend, collateralKey, enabled])

	const selectedCollateral = collateralLoaded.value?.key === collateralKey ? collateralLoaded.value : undefined
	const collateral = selectedCollateral?.collateral
	const collateralQuote = selectedCollateral?.quote
	const requiredCollateral = collateralQuote === undefined ? undefined : collateralQuote.amount + collateralQuote.maximumFee
	let collateralReason: string | undefined
	if (accountAddress === undefined) collateralReason = 'Connect wallet'
	else if (selectedCollateral?.error !== undefined) collateralReason = selectedCollateral.error
	else if (collateral === undefined) collateralReason = 'Loading collateral funding.'
	else if (requiredCollateral === undefined) collateralReason = 'Enter a positive collateral amount.'
	else if (collateral.balance < requiredCollateral) collateralReason = 'Insufficient collateral balance.'
	else if (collateral.allowance < requiredCollateral) collateralReason = 'Collateral approval required.'

	return {
		collateral,
		requiredCollateral,
		reason: collateralReason,
		loading: selectedCollateral === undefined,
		error: tradingError.value ?? selectedCollateral?.error,
		pending: approvalPending.value,
		resetting: approvalPending.value && approvalAmount.value === 0n,
		approve: async (amount: bigint) => {
			if (approvalPending.value || collateral === undefined || accountAddress === undefined) return
			approvalPending.value = true
			approvalAmount.value = amount
			try {
				await runWriteAction(
					buildWriteActionConfig({ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, refreshState }, tradingError, 'Connect wallet', {
						action: 'approvePurchaseCollateral',
						source: 'Complete sets',
						submittedTitle: 'Approve collateral',
					}),
					async (account, context) => {
						const allowance = await createConnectedReadClient().readContract({ address: collateral.token, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [account, collateral.services] })
						if (typeof allowance !== 'bigint') throw new Error('Collateral allowance unavailable.')
						const reason = getTokenApprovalResetReason(allowance, amount, collateral.symbol, collateral.symbol === 'USDT')
						if (reason !== undefined) throw new Error(reason)
						const client = createWalletWriteClient(account, { onTransactionPrepared, onTransactionSubmitted, reviewSignal: context.reviewSignal })
						const hash = await client.writeContract({ address: collateral.token, abi: ABIS.mainnet.erc20, functionName: 'approve', args: [collateral.services, amount] })
						const receipt = await client.waitForTransactionReceipt({ hash })
						if (receipt.status !== 'success') throw new Error('Collateral approval failed.')
						return { hash }
					},
					'Collateral approval failed.',
				)
				collateralVersion.value++
			} finally {
				approvalPending.value = false
			}
		},
	}
}
