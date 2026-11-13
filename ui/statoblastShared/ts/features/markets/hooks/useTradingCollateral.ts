import { getTokenApprovalResetReason, tokenRequiresAllowanceReset } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
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
	const collateralLoaded = useSignal<{ key: string; collateral?: Awaited<ReturnType<typeof loadTradingCollateral>>; quoteInput?: string; quote?: Awaited<ReturnType<typeof quoteTradingCollateral>> | undefined; error?: string }>()
	const approvalPending = useSignal(false)
	const approvalAmount = useSignal<bigint | undefined>(undefined)
	const collateralVersion = useSignal(0)
	const backend = getActiveBackend()
	const collateralPool = pool !== undefined && isAddress(pool) ? getAddress(pool) : undefined
	const collateralKey = `${backend.id}:${collateralPool}:${accountAddress}`
	const currentAmount = useRef(amountInput)
	currentAmount.current = amountInput
	const refreshCollateral = useRef<(() => void) | undefined>(undefined)
	useBlockRefresh(() => refreshCollateral.current?.(), enabled && collateralPool !== undefined && accountAddress !== undefined)
	useEffect(() => {
		let active = true
		let inFlight = false
		let queued = false
		let identity: Awaited<ReturnType<typeof loadTradingCollateral>> | undefined
		collateralLoaded.value = undefined
		const refresh = () => {
			if (!active || !enabled || collateralPool === undefined || accountAddress === undefined) return
			if (inFlight) {
				queued = true
				return
			}
			inFlight = true
			void (async () => {
				const client = createConnectedReadClient()
				const quoteInput = currentAmount.current
				const collateral = await loadTradingCollateral(client, collateralPool, accountAddress, identity)
				identity = collateral
				const amount = portfolioAmountOrUndefined(quoteInput, collateral.decimals)
				const quote = amount !== undefined && amount > 0n ? await quoteTradingCollateral(client, collateral, amount) : undefined
				if (active && getActiveBackend() === backend) collateralLoaded.value = { key: collateralKey, collateral, quote, quoteInput }
			})()
				.catch(error => {
					if (active && getActiveBackend() === backend) {
						const previous = collateralLoaded.peek()
						collateralLoaded.value = { ...(previous?.key === collateralKey ? previous : { key: collateralKey }), error: getErrorMessage(error, 'Unable to load collateral funding.') }
					}
				})
				.finally(() => {
					inFlight = false
					if (active && queued) {
						queued = false
						refresh()
					}
				})
		}
		refreshCollateral.current = refresh
		refresh()
		return () => {
			active = false
			if (refreshCollateral.current === refresh) refreshCollateral.current = undefined
		}
	}, [backend, collateralKey, enabled])

	const previousInput = useRef(amountInput)
	const previousVersion = useRef(collateralVersion.value)
	useEffect(() => {
		if (previousVersion.current !== collateralVersion.value) {
			previousVersion.current = collateralVersion.value
			refreshCollateral.current?.()
		}
		if (previousInput.current === amountInput) return
		previousInput.current = amountInput
		const timer = setTimeout(() => refreshCollateral.current?.(), 250)
		return () => clearTimeout(timer)
	}, [amountInput, collateralVersion.value])

	const selectedCollateral = collateralLoaded.value?.key === collateralKey ? collateralLoaded.value : undefined
	const collateral = selectedCollateral?.collateral
	const collateralQuote = selectedCollateral?.quoteInput === amountInput ? selectedCollateral.quote : undefined
	const requiredCollateral = collateralQuote === undefined ? undefined : collateralQuote.amount + collateralQuote.maximumFee
	let collateralReason: string | undefined
	if (accountAddress === undefined) collateralReason = 'Connect wallet'
	else if (selectedCollateral?.error !== undefined) collateralReason = selectedCollateral.error
	else if (collateral === undefined) collateralReason = 'Loading collateral funding.'
	else if (requiredCollateral === undefined) collateralReason = (portfolioAmountOrUndefined(amountInput, collateral.decimals) ?? 0n) > 0n ? 'Updating collateral quote.' : 'Enter a positive collateral amount.'
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
						const reason = getTokenApprovalResetReason(allowance, amount, collateral.symbol, tokenRequiresAllowanceReset(collateral.token))
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
