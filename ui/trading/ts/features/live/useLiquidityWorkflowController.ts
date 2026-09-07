import type { Address, Hash, WalletClient } from '@zoltar/shared/ethereum'
import { createExclusiveWorkflowGuard, createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { waitForSubmittedTransactionReceipt } from '@zoltar/ui-core-shared/lib/transactionReceipt.js'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { parseUnitsOrUndefined } from '../../lib/format.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { marketAcceptsNewRisk, type LiquidityOperation, type LiveMarket } from '../../protocol/live.js'
import type { LiveLiquidityServices } from '../LiveLiquidityControls.js'
import { DEFAULT_SLIPPAGE_PERCENT, DEFAULT_TRANSACTION_VALIDITY_MINUTES } from '../LiveTradingTransactionUi.js'
import { broadcastUncertainMessage, failedSubmissionTransition, parseSlippageBps, parseTransactionValidityMinutes, positionControlsWorkflowLocked, type GuardedWalletWrite } from '../liveTradingControllerHelpers.js'
import type { BalanceState, QuoteContext, TransactionState } from './liveTradingTypes.js'

type LiquidityQuote = Awaited<ReturnType<LiveLiquidityServices['simulateLiquidity']>> & QuoteContext

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
	const [state, setState] = useState<TransactionState>('idle')
	const [transactionHash, setTransactionHash] = useState<Hash>()
	const [error, setError] = useState<string>()
	const [receiptWarning, setReceiptWarning] = useState<string>()
	const simulationRequests = useRef(createLatestRequestGuard()).current
	const workflow = useRef(createExclusiveWorkflowGuard()).current
	const mounted = useRef(true)
	const parsed = useMemo(() => parseUnitsOrUndefined(amount), [amount])
	const slippageBps = useMemo(() => parseSlippageBps(slippage), [slippage])
	const validityMinutes = useMemo(() => parseTransactionValidityMinutes(transactionValidityMinutes), [transactionValidityMinutes])
	const conditionalBps = useMemo(() => {
		const value = parseUnitsOrUndefined(probability, 2)
		return value !== undefined && value > 0n && value < 10_000n ? value : undefined
	}, [probability])
	const operationAvailable = liquidityOperationAvailable(operation, market, nowSeconds)
	const workflowLocked = externallyLocked || positionControlsWorkflowLocked(state, receiptWarning)

	function invalidate() {
		if (receiptWarning !== undefined || workflow.isActive()) return false
		simulationRequests.invalidate()
		setQuote(undefined)
		setTransactionHash(undefined)
		setState('idle')
		return true
	}

	useEffect(() => {
		if (receiptWarning !== undefined) return
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!workflow.isActive()) {
			setTransactionHash(undefined)
			setState('idle')
		}
		return () => simulationRequests.invalidate()
	}, [account, configuration, market.pool, receiptWarning, walletClient])

	useEffect(() => {
		if ((balanceState === 'ready' && operationAvailable) || receiptWarning !== undefined) return
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!workflow.isActive()) {
			setState('idle')
			if (!operationAvailable) setError(undefined)
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
		setState('simulating')
		setTransactionHash(undefined)
		setError(undefined)
		try {
			const simulated = await services.simulateLiquidity(walletClient, configuration, market, account, operation, parsed, conditionalBps ?? 5_000n, validityMinutes, slippageBps)
			if (!mounted.current || !simulationRequests.isCurrent(request)) return
			setQuote({ ...simulated, account, configuration, walletClient })
			setState('ready')
		} catch (caught) {
			if (!mounted.current || !simulationRequests.isCurrent(request)) return
			setState('error')
			setError(services.publicErrorMessage(caught, 'Liquidity simulation failed'))
		}
	}

	async function submit() {
		if (walletClient === undefined || account === undefined || quote === undefined || externallyLocked || !workflow.begin()) return
		if (!liquidityOperationAvailable(quote.operation, quote.market, nowSeconds)) {
			setQuote(undefined)
			setState('error')
			setError('This market no longer accepts liquidity initialization or additions. Raw liquidity removal remains available.')
			workflow.finish()
			return
		}
		onWorkflowLockChange(true)
		setState('preparing')
		setReceiptWarning(undefined)
		setTransactionHash(undefined)
		let broadcastHash: Hash | undefined
		let receiptKnown = false
		let keepLocked = false
		try {
			if (
				quote.account !== account ||
				quote.walletClient !== walletClient ||
				quote.configuration.chainId !== configuration.chainId ||
				quote.configuration.router !== configuration.router ||
				quote.market.pool !== market.pool ||
				quote.operation !== operation ||
				quote.amount !== parsed ||
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
						if (mounted.current) setState('submitting')
						return await write()
					}),
			)
			if (!mounted.current) return
			setTransactionHash(broadcastHash)
			setState('pending')
			const { receipt } = await waitForSubmittedTransactionReceipt(walletClient, broadcastHash, {
				allowRevertedReceipt: true,
				onKnownReceipt: () => {
					receiptKnown = true
					onKnownReceipt()
				},
				onTransactionReplaced: replacementHash => {
					broadcastHash = replacementHash
					if (mounted.current) setTransactionHash(replacementHash)
				},
			})
			if (!mounted.current) return
			if (receipt.status === 'reverted') throw new Error('Liquidity transaction reverted')
			setQuote(undefined)
			setReceiptWarning(undefined)
			setState('confirmed')
			await refresh()
		} catch (caught) {
			if (!mounted.current) return
			if (broadcastHash !== undefined && !receiptKnown) {
				keepLocked = true
				setState('pending')
				setReceiptWarning(broadcastUncertainMessage('Liquidity transaction', broadcastHash))
				setError(undefined)
			} else {
				const failure = failedSubmissionTransition(caught, 'Liquidity transaction failed')
				setQuote(failure.quote)
				setState(failure.state)
				setError(failure.message)
				setReceiptWarning(undefined)
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
