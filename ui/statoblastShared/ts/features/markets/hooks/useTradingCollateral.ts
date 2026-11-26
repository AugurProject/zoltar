import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { isAddress, getAddress } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as collateralCopy from '../../../copy/collateral.js'
import { completeSets } from '../../../copy/trading.js'
import { insufficientMintCapacity, maximumMintAmountNotFunded, maximumMintAmountUnavailable } from '../../../copy/securityPool.js'
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { parseCompleteSetAmountInput } from '../lib/trading.js'
import { loadMaximumTradingMintAmount, loadTradingCollateral, quoteTradingCollateral } from '../../../protocol/trading.js'
import { withStatoblastRequestTimeout } from '../../../protocol/requestTimeout.js'
import type { WriteOperationsParameters } from '../../../types/app.js'

export function useTradingCollateral({ pool, amountInput, ...parameters }: WriteOperationsParameters & { pool: string | undefined; amountInput: string; enabled: boolean }) {
	const { accountAddress, enabled, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState } = parameters
	const tradingError = useSignal<string | undefined>(undefined)
	const collateralLoaded = useSignal<{ key: string; collateral?: Awaited<ReturnType<typeof loadTradingCollateral>>; quoteInput?: string; quote?: Awaited<ReturnType<typeof quoteTradingCollateral>> | undefined; error?: string }>()
	const recoveryKnowledge = useSignal<{ key: string; applicable: boolean }>()
	const approvalPending = useSignal<'collateral' | 'recovery' | undefined>(undefined)
	const maximumSearch = useSignal<{ key: string; abort: AbortController }>()
	const maximumError = useSignal<{ key: string; message: string }>()
	const collateralVersion = useSignal(0)
	const backend = getActiveBackend()
	const collateralPool = pool !== undefined && isAddress(pool) ? getAddress(pool) : undefined
	const collateralKey = `${backend.id}:${collateralPool}:${accountAddress}`
	const recoverySelection = `${collateralKey}:${amountInput}`
	useEffect(() => {
		recoveryKnowledge.value = undefined
	}, [recoverySelection])
	useEffect(() => {
		const cancelSearch = () => {
			const search = maximumSearch.peek()
			if (search?.key !== collateralKey) return
			search.abort.abort()
			maximumSearch.value = undefined
		}
		const onVisibility = () => {
			if (document.hidden) cancelSearch()
		}
		document.addEventListener('visibilitychange', onVisibility)
		return () => {
			document.removeEventListener('visibilitychange', onVisibility)
			cancelSearch()
			if (maximumError.peek()?.key === collateralKey) maximumError.value = undefined
		}
	}, [backend, collateralKey, enabled])
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
				const amount = parseCompleteSetAmountInput(quoteInput, collateral.decimals)
				const quote =
					amount !== undefined && amount > 0n
						? await quoteTradingCollateral(client, collateral, collateralPool, amount, required => {
								if (active && getActiveBackend() === backend && currentAmount.current === quoteInput) recoveryKnowledge.value = { key: `${collateralKey}:${quoteInput}`, applicable: required > 0n }
							})
						: undefined
				if (active && getActiveBackend() === backend) collateralLoaded.value = { key: collateralKey, collateral, quote, quoteInput }
			})()
				.catch(error => {
					if (active && getActiveBackend() === backend) {
						const previous = collateralLoaded.peek()
						collateralLoaded.value = { ...(previous?.key === collateralKey ? previous : { key: collateralKey }), error: getErrorMessage(error, collateralCopy.fundingReadFailed) }
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
	const requiredCollateral = collateralQuote === undefined ? undefined : collateralQuote.amount + collateralQuote.fee
	const findMaximumMintAmount = async () => {
		if (!enabled || collateralPool === undefined || collateral === undefined || document.hidden || maximumSearch.peek()?.key === collateralKey) return undefined
		const abort = new AbortController()
		const search = { key: collateralKey, abort }
		maximumSearch.value = search
		maximumError.value = undefined
		try {
			const client = withStatoblastRequestTimeout(createConnectedReadClient(), maximumMintAmountUnavailable, abort.signal)
			const maximum = await loadMaximumTradingMintAmount(client, collateral, collateralPool)
			if (abort.signal.aborted || getActiveBackend() !== backend) return undefined
			if (maximum === undefined) maximumError.value = { key: collateralKey, message: maximumMintAmountNotFunded }
			return maximum
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return undefined
			if (!abort.signal.aborted && getActiveBackend() === backend) maximumError.value = { key: collateralKey, message: maximumMintAmountUnavailable }
			return undefined
		} finally {
			if (maximumSearch.peek() === search) maximumSearch.value = undefined
		}
	}
	let collateralReason: string | undefined
	if (accountAddress === undefined) collateralReason = commonCopy.walletConnectionRequired
	else if (selectedCollateral?.error !== undefined) collateralReason = selectedCollateral.error
	else if (collateral === undefined) collateralReason = collateralCopy.fundingLoading
	else if (requiredCollateral === undefined) collateralReason = (parseCompleteSetAmountInput(amountInput, collateral.decimals) ?? 0n) > 0n ? collateralCopy.updatingCollateralQuote : collateralCopy.positiveCollateralAmountRequired
	else if (collateralQuote !== undefined && collateralQuote.amount > collateralQuote.capacity) collateralReason = insufficientMintCapacity
	else if (collateral.balance < requiredCollateral) collateralReason = collateralCopy.formatInsufficientBalance(collateral.symbol)
	else if (collateral.allowance < requiredCollateral) collateralReason = collateralCopy.approvalRequired
	else if (collateralQuote !== undefined && collateralQuote.recovery.balance < collateralQuote.recovery.maximum) collateralReason = collateralCopy.insufficientRecoveryRep
	else if (collateralQuote !== undefined && collateralQuote.recovery.allowance < collateralQuote.recovery.maximum) collateralReason = collateralCopy.recoveryApprovalRequired

	const approve = async (amount: bigint, recovery: boolean) => {
		if (approvalPending.value !== undefined || collateral === undefined || accountAddress === undefined || selectedCollateral?.error !== undefined) return
		const asset = recovery ? collateralQuote?.recovery : { token: collateral.token, spender: collateral.services }
		if (asset?.token === undefined || asset.spender === undefined) return
		approvalPending.value = recovery ? 'recovery' : 'collateral'
		try {
			await runWriteAction(
				buildWriteActionConfig({ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, refreshState }, tradingError, commonCopy.formatConnectWalletBefore(collateralCopy.approvingCollateralAction), {
					action: recovery ? 'approvePurchaseRecoveryRep' : 'approvePurchaseCollateral',
					source: completeSets,
					submittedTitle: recovery ? collateralCopy.approveRecoveryRep : collateralCopy.approveCollateral,
				}),
				async (account, context) => {
					const client = createWalletWriteClient(account, { onTransactionPrepared, onTransactionSubmitted, reviewSignal: context.reviewSignal })
					const hash = await client.writeContract({ address: asset.token, abi: ABIS.mainnet.erc20, functionName: 'approve', args: [asset.spender, amount] })
					const receipt = await client.waitForTransactionReceipt({ hash })
					if (receipt.status !== 'success') throw new Error(collateralCopy.approvalFailed)
					return { hash }
				},
				collateralCopy.approvalFailed,
			)
			collateralVersion.value++
		} finally {
			approvalPending.value = undefined
		}
	}
	if (approvalPending.value !== undefined) collateralReason = collateralCopy.approvalPending
	return {
		...(collateralQuote === undefined ? {} : { mintQuote: collateralQuote }),
		...(enabled && collateral !== undefined
			? {
					findMaximumMintAmount,
					findingMaximumMintAmount: maximumSearch.value?.key === collateralKey,
					maximumMintAmountError: maximumError.value?.key === collateralKey ? maximumError.value.message : undefined,
				}
			: {}),
		recoveryApplicable: recoveryKnowledge.value?.key === recoverySelection && recoveryKnowledge.value.applicable,
		recovery: collateralQuote?.recovery,
		approve: (amount: bigint) => approve(amount, false),
		approveRecovery: (amount: bigint) => approve(amount, true),
		collateral,
		requiredCollateral,
		reason: collateralReason,
		loading: selectedCollateral === undefined,
		error: tradingError.value ?? selectedCollateral?.error,
		pending: approvalPending.value === 'collateral',
		pendingRecovery: approvalPending.value === 'recovery',
		approvalActive: approvalPending.value !== undefined,
	}
}
