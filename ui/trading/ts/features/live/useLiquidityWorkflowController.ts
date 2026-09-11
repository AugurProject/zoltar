import type { Address, Hash, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { createExclusiveWorkflowGuard, createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { waitForSubmittedTransactionReceipt } from '@zoltar/ui-core-shared/transactions/transactionReceipt.js'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks'
import { parseUnitsOrUndefined } from '../../lib/format.js'
import { collateralAttoEthToAttoShares } from '../../lib/shareValue.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { marketAcceptsNewRisk, type LiquidityOperation, type LiveMarket } from '../../protocol/live.js'
import type { LiveLiquidityServices } from '../LiveLiquidityControls.js'
import { DEFAULT_SLIPPAGE_PERCENT, DEFAULT_TRANSACTION_VALIDITY_MINUTES } from '../LiveTradingTransactionUi.js'
import { broadcastUncertainMessage, parseSlippageBps, parseTransactionValidityMinutes, positionControlsWorkflowLocked, quoteBasisChanged, type GuardedWalletWrite } from '../liveTradingControllerHelpers.js'
import type { BalanceState, QuoteContext } from './liveTradingTypes.js'
import { idleTransactionWorkflow, transactionPhase, transactionWorkflowError, transactionWorkflowHash, transactionWorkflowReceiptWarning, transactionWorkflowReducer, type TransactionContext } from './transactionWorkflow.js'

type LiquidityQuote = Awaited<ReturnType<LiveLiquidityServices['simulateLiquidity']>> & QuoteContext & Readonly<{ requestRevision: number }>

export function liquidityOperationAvailable(operation: LiquidityOperation, market: LiveMarket, nowSeconds: bigint) {
	return operation === 'remove' || marketAcceptsNewRisk(market, nowSeconds)
}

export function useLiquidityWorkflowController({
	configuration,
	market,
	balanceState,
	account,
	walletClient,
	externallyLocked,
	nowSeconds,
	refresh,
	onKnownReceipt,
	executeWithCurrentWalletContext,
	createGuardedWalletWrite,
	onWorkflowLockChange,
	services,
}: {
	configuration: DeploymentConfiguration
	market: LiveMarket
	balanceState: BalanceState
	account: Address | undefined
	walletClient: WalletClient | undefined
	externallyLocked: boolean
	nowSeconds: bigint
	refresh(): Promise<void>
	onKnownReceipt(): void
	executeWithCurrentWalletContext<T>(account: Address, networkFailure: string, accountFailure: string, action: () => Promise<T>): Promise<T>
	createGuardedWalletWrite(account: Address, networkFailure: string, accountFailure: string): GuardedWalletWrite
	onWorkflowLockChange(locked: boolean): void
	services: LiveLiquidityServices
}) {
	const [operation, setOperation] = useState<LiquidityOperation>(market.pair === undefined || market.lpTotalSupply === 0n ? 'initialize' : 'add')
	const [amount, setAmount] = useState('0.01')
	const [probability, setProbability] = useState('50')
	const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE_PERCENT)
	const [transactionValidityMinutes, setTransactionValidityMinutes] = useState(DEFAULT_TRANSACTION_VALIDITY_MINUTES)
	const [quote, setQuote] = useState<LiquidityQuote>()
	const [workflowState, dispatchWorkflow] = useReducer(transactionWorkflowReducer, idleTransactionWorkflow)
	const state = transactionPhase(workflowState)
	const transactionHash = transactionWorkflowHash(workflowState)
	const error = transactionWorkflowError(workflowState, 'Liquidity transaction reverted')
	const receiptWarning = transactionWorkflowReceiptWarning(workflowState)
	const simulationRequests = useRef(createLatestRequestGuard()).current
	const workflow = useRef(createExclusiveWorkflowGuard()).current
	const mounted = useRef(true)
	const inputRevision = useRef(0)
	// ETH entries fund the pair directly; LP removals are entered on the collateral-value scale shared with share amounts.
	const requestedAmount = useCallback(
		(rate: LiveMarket) => {
			const value = parseUnitsOrUndefined(amount)
			if (value === undefined || operation !== 'remove') return value
			return collateralAttoEthToAttoShares(value, rate)
		},
		[amount, operation],
	)
	const parsed = useMemo(() => requestedAmount(market), [market, requestedAmount])
	const slippageBps = useMemo(() => parseSlippageBps(slippage), [slippage])
	const validityMinutes = useMemo(() => parseTransactionValidityMinutes(transactionValidityMinutes), [transactionValidityMinutes])
	const conditionalBps = useMemo(() => {
		const value = parseUnitsOrUndefined(probability, 2)
		return value !== undefined && value > 0n && value < 10_000n ? value : undefined
	}, [probability])
	const operationAvailable = liquidityOperationAvailable(operation, market, nowSeconds)
	const workflowLocked = externallyLocked || positionControlsWorkflowLocked(state, receiptWarning)
	const transactionContext = (expectedAccount: Address, revision: number): TransactionContext => ({ account: expectedAccount, chainId: configuration.chainId, market: market.pool, requestRevision: revision })

	function invalidate() {
		if (receiptWarning !== undefined || workflow.isActive()) return false
		inputRevision.current++
		simulationRequests.invalidate()
		setQuote(undefined)
		dispatchWorkflow({ type: 'inputs-invalidated' })
		return true
	}

	useEffect(() => {
		if (receiptWarning !== undefined) return
		inputRevision.current++
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!workflow.isActive()) dispatchWorkflow({ type: 'inputs-invalidated' })
		return () => simulationRequests.invalidate()
	}, [account, configuration, market.pool, receiptWarning, walletClient])

	// A liquidity quote prices exact reserves and the pool rate; a background refresh that moves them retires it.
	const quoteBasis = quote === undefined ? undefined : quote.market
	useEffect(() => {
		if (quoteBasis === undefined || !quoteBasisChanged(quoteBasis, market) || workflow.isActive()) return
		inputRevision.current++
		simulationRequests.invalidate()
		setQuote(undefined)
		dispatchWorkflow({ type: 'inputs-invalidated' })
	}, [market, quoteBasis])

	useEffect(() => {
		if ((balanceState === 'ready' && operationAvailable) || receiptWarning !== undefined) return
		inputRevision.current++
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!workflow.isActive()) {
			dispatchWorkflow({ type: 'inputs-invalidated' })
		}
	}, [balanceState, operationAvailable, receiptWarning])

	useEffect(
		() => () => {
			mounted.current = false
			simulationRequests.invalidate()
			if (workflow.isActive()) workflow.finish()
			onWorkflowLockChange(false)
		},
		[onWorkflowLockChange],
	)

	async function simulateCurrent() {
		if (!operationAvailable || walletClient === undefined || account === undefined || parsed === undefined || parsed === 0n || slippageBps === undefined || validityMinutes === undefined || (operation === 'initialize' && conditionalBps === undefined)) return
		const request = simulationRequests.begin()
		const revision = inputRevision.current
		const context = transactionContext(account, revision)
		dispatchWorkflow({ type: 'simulation-started', context })
		try {
			const simulated = await services.simulateLiquidity(walletClient, configuration, market, account, operation, parsed, conditionalBps ?? 5_000n, validityMinutes, slippageBps)
			if (!mounted.current || !simulationRequests.isCurrent(request) || inputRevision.current !== revision) return
			setQuote({ ...simulated, account, configuration, walletClient, requestRevision: revision })
			dispatchWorkflow({ type: 'simulation-succeeded', context })
		} catch (caught) {
			if (!mounted.current || !simulationRequests.isCurrent(request) || inputRevision.current !== revision) return
			dispatchWorkflow({ type: 'failed', context, message: services.publicErrorMessage(caught, 'Liquidity simulation failed') })
		}
	}

	async function submit() {
		if (walletClient === undefined || account === undefined || quote === undefined || workflowState.kind !== 'ready-to-submit' || externallyLocked || !workflow.begin()) return
		if (!liquidityOperationAvailable(quote.operation, quote.market, nowSeconds)) {
			setQuote(undefined)
			dispatchWorkflow({ type: 'failed', operation: 'liquidity', message: 'This market no longer accepts liquidity initialization or additions. Raw liquidity removal remains available.' })
			workflow.finish()
			return
		}
		const context = workflowState.context
		onWorkflowLockChange(true)
		dispatchWorkflow({ type: 'operation-preparing', context, operation: 'liquidity' })
		let broadcastHash: Hash | undefined
		let receiptKnown = false
		let keepLocked = false
		let signatureRequested = false
		try {
			if (
				quote.account !== account ||
				quote.walletClient !== walletClient ||
				quote.configuration.chainId !== configuration.chainId ||
				quote.configuration.router !== configuration.router ||
				quote.market.pool !== market.pool ||
				quote.requestRevision !== inputRevision.current ||
				quote.operation !== operation ||
				// Convert with the quoted market so a background rate refresh cannot masquerade as an input change.
				quote.amount !== requestedAmount(quote.market) ||
				(operation === 'initialize' && quote.conditionalYesBps !== conditionalBps)
			)
				throw new Error('Liquidity inputs changed; simulate the current selection again')
			simulationRequests.invalidate()
			await executeWithCurrentWalletContext(account, 'Wallet network changed; switch back before submitting', 'Wallet account changed; reconnect and simulate again', async () => undefined)
			const guardedWrite = createGuardedWalletWrite(account, 'Wallet network changed during liquidity revalidation; reconnect and simulate again', 'Wallet account changed during liquidity revalidation; reconnect and simulate again')
			broadcastHash = await services.submitFreshLiquidity(
				walletClient,
				configuration,
				account,
				quote,
				async write =>
					await guardedWrite(async () => {
						if (mounted.current) {
							signatureRequested = true
							dispatchWorkflow({ type: 'signature-requested', context, operation: 'liquidity' })
						}
						return await write()
					}),
			)
			if (!mounted.current) return
			if (!signatureRequested) dispatchWorkflow({ type: 'signature-requested', context, operation: 'liquidity' })
			dispatchWorkflow({ type: 'broadcast', context, operation: 'liquidity', transactionHash: broadcastHash })
			const { receipt } = await waitForSubmittedTransactionReceipt(walletClient, broadcastHash, {
				allowRevertedReceipt: true,
				onKnownReceipt: () => {
					receiptKnown = true
					onKnownReceipt()
				},
				onTransactionReplaced: replacementHash => {
					broadcastHash = replacementHash
					if (mounted.current) dispatchWorkflow({ type: 'replaced', context, replacementHash })
				},
			})
			if (!mounted.current) return
			if (receipt.status === 'reverted') {
				dispatchWorkflow({ type: 'reverted', context })
				return
			}
			setQuote(undefined)
			dispatchWorkflow({ type: 'confirmed', context })
			await refresh()
		} catch (caught) {
			if (!mounted.current) return
			if (broadcastHash !== undefined && !receiptKnown) {
				keepLocked = true
				dispatchWorkflow({ type: 'uncertain', context, reason: broadcastUncertainMessage('Liquidity transaction', broadcastHash) })
			} else {
				setQuote(undefined)
				dispatchWorkflow({ type: 'failed', context, operation: 'liquidity', message: services.publicErrorMessage(caught, 'Liquidity transaction failed') })
			}
		} finally {
			workflow.finish()
			if (!keepLocked) onWorkflowLockChange(false)
		}
	}

	return {
		operation,
		amount,
		probability,
		slippage,
		transactionValidityMinutes,
		quote,
		state,
		transactionHash,
		error,
		receiptWarning,
		parsed,
		slippageBps,
		validityMinutes,
		conditionalBps,
		operationAvailable,
		workflowLocked,
		workflowIsActive: () => workflow.isActive(),
		selectOperation(next: LiquidityOperation) {
			if (!invalidate()) return
			setOperation(next)
		},
		updateAmount(value: string) {
			if (!invalidate()) return
			setAmount(value)
		},
		updateProbability(value: string) {
			if (!invalidate()) return
			setProbability(value)
		},
		updateSlippage(value: string) {
			if (!invalidate()) return
			setSlippage(value)
		},
		updateValidity(value: string) {
			if (!invalidate()) return
			setTransactionValidityMinutes(value)
		},
		simulateCurrent,
		submit,
	}
}
