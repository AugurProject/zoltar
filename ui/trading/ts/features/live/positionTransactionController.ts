import type { Address, Hash } from '@zoltar/shared/evm/ethereum'
import { waitForSubmittedTransactionReceipt } from '@zoltar/ui-core-shared/transactions/transactionReceipt.js'
import type { createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { publicErrorMessage, type LiveMarket } from '../../protocol/live.js'
import type { LiveTradingControllerServices, Quote } from './liveTradingTypes.js'
import type { useTransactionWorkflow } from './useTransactionWorkflow.js'
import type { TransactionContext } from './transactionWorkflow.js'
import { broadcastUncertainMessage, failedSubmissionTransition, parseSlippageBps, parseTransactionValidityMinutes, type GuardedWalletWrite, type WorkflowOwner } from '../liveTradingControllerHelpers.js'

type RequestGuard = ReturnType<typeof createLatestRequestGuard>
type TransactionWorkflow = ReturnType<typeof useTransactionWorkflow>
type Refresh = (configuration?: DeploymentConfiguration, requestedStart?: bigint, owner?: WorkflowOwner) => Promise<void>

export function createPositionTransactionController({
	configuration,
	selected,
	account,
	walletClient,
	parsedAmount,
	workflow,
	services,
	simulationRequests,
	nextTransactionContext,
	createGuardedWalletWrite,
	executeWithCurrentWalletContext,
	refreshWalletSummaryAfterReceipt,
	refresh,
	marketPageStart,
}: {
	configuration: DeploymentConfiguration | undefined
	selected: LiveMarket | undefined
	account: Address | undefined
	walletClient: Parameters<LiveTradingControllerServices['simulateEntry']>[0] | undefined
	parsedAmount: Readonly<{ value: bigint | undefined; error: string | undefined }>
	workflow: TransactionWorkflow
	services: LiveTradingControllerServices
	simulationRequests: RequestGuard
	nextTransactionContext(expectedAccount: Address, market: LiveMarket, chainId: number): TransactionContext
	createGuardedWalletWrite(expectedAccount: Address, networkFailure: string, accountFailure: string): GuardedWalletWrite
	executeWithCurrentWalletContext<T>(expectedAccount: Address, networkFailure: string, accountFailure: string, action: () => Promise<T>): Promise<T>
	refreshWalletSummaryAfterReceipt(): void
	refresh: Refresh
	marketPageStart: bigint
}) {
	const { mode, side, slippage, transactionValidityMinutes, quote, setQuote, workflowState, dispatchWorkflow, positionWorkflow, positionWorkflowLockedRef, liquidityWorkflowLockedRef, updatePositionWorkflowLock, setMode, setSide, setAmount, setSlippage, setTransactionValidityMinutes } = workflow

	async function simulate() {
		const slippageBps = parseSlippageBps(slippage)
		const validityMinutes = parseTransactionValidityMinutes(transactionValidityMinutes)
		if (configuration === undefined || selected === undefined || account === undefined || walletClient === undefined || parsedAmount.value === undefined || parsedAmount.value === 0n || slippageBps === undefined || validityMinutes === undefined) return
		const request = simulationRequests.begin()
		const context = nextTransactionContext(account, selected, configuration.chainId)
		try {
			dispatchWorkflow({ type: 'simulation-started', context })
			const quoteContext = { account, configuration, walletClient }
			const nextQuote: Quote =
				mode === 'entry'
					? { ...quoteContext, kind: 'entry', value: await services.simulateEntry(walletClient, configuration, selected, account, side, parsedAmount.value, validityMinutes, slippageBps) }
					: { ...quoteContext, kind: 'exit', value: await services.simulateExit(walletClient, configuration, selected, account, side, parsedAmount.value, validityMinutes, slippageBps) }
			if (!simulationRequests.isCurrent(request)) return
			setQuote(nextQuote)
			dispatchWorkflow({ type: 'simulation-succeeded', context })
		} catch (error) {
			if (!simulationRequests.isCurrent(request)) return
			setQuote(undefined)
			dispatchWorkflow({ type: 'failed', context, operation: 'trade', message: publicErrorMessage(error, 'Router simulation failed') })
		}
	}

	async function submit() {
		if (configuration === undefined || account === undefined || walletClient === undefined || quote === undefined || selected === undefined) return
		if (positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current || !positionWorkflow.begin()) return
		const context = workflowState.kind === 'ready-to-submit' ? workflowState.context : nextTransactionContext(account, selected, configuration.chainId)
		updatePositionWorkflowLock(true)
		dispatchWorkflow({ type: 'operation-preparing', context, operation: 'trade' })
		let broadcastHash: Hash | undefined
		let receiptKnown = false
		let keepLocked = false
		try {
			const quotedAmount = quote.kind === 'entry' ? quote.value.amount : quote.value.completeSets
			if (
				quote.account !== account ||
				quote.walletClient !== walletClient ||
				quote.configuration.chainId !== configuration.chainId ||
				quote.configuration.router !== configuration.router ||
				quote.value.market.pool !== selected.pool ||
				quote.value.side !== side ||
				quote.kind !== mode ||
				parsedAmount.value !== quotedAmount
			)
				throw new Error('Trade inputs changed; simulate the current selection again')
			simulationRequests.invalidate()
			await executeWithCurrentWalletContext(account, 'Wallet network changed; switch back before submitting', 'Wallet account changed; reconnect and simulate again', async () => undefined)
			const guardedPositionWrite = createGuardedWalletWrite(account, 'Wallet network changed during transaction revalidation; reconnect and simulate again', 'Wallet account changed during transaction revalidation; reconnect and simulate again')
			const guardedWrite: GuardedWalletWrite = async write =>
				await guardedPositionWrite(async () => {
					dispatchWorkflow({ type: 'signature-requested', context, operation: 'trade' })
					return await write()
				})
			broadcastHash = quote.kind === 'entry' ? await services.submitFreshEntry(walletClient, configuration, account, quote.value, guardedWrite) : await services.submitFreshExit(walletClient, configuration, account, quote.value, guardedWrite)
			dispatchWorkflow({ type: 'broadcast', context, operation: 'trade', transactionHash: broadcastHash })
			const { receipt } = await waitForSubmittedTransactionReceipt(walletClient, broadcastHash, {
				allowRevertedReceipt: true,
				onKnownReceipt: () => {
					receiptKnown = true
					refreshWalletSummaryAfterReceipt()
				},
				onTransactionReplaced: replacementHash => {
					broadcastHash = replacementHash
					dispatchWorkflow({ type: 'replaced', context, replacementHash })
				},
			})
			if (receipt.status === 'reverted') {
				dispatchWorkflow({ type: 'reverted', context })
				return
			}
			setQuote(undefined)
			dispatchWorkflow({ type: 'confirmed', context })
			await refresh(configuration, marketPageStart, 'position')
		} catch (error) {
			if (broadcastHash !== undefined && !receiptKnown) {
				keepLocked = true
				dispatchWorkflow({ type: 'uncertain', context, reason: broadcastUncertainMessage('Transaction', broadcastHash) })
			} else {
				const failure = failedSubmissionTransition(error, 'Transaction failed')
				setQuote(failure.quote)
				dispatchWorkflow({ type: 'failed', context, operation: 'trade', message: failure.message })
			}
		} finally {
			positionWorkflow.finish()
			if (!keepLocked) updatePositionWorkflowLock(false)
		}
	}

	function resetPositionInput(update: () => void) {
		if (positionWorkflowLockedRef.current) return
		simulationRequests.invalidate()
		update()
		setQuote(undefined)
		dispatchWorkflow({ type: 'reset' })
	}

	return {
		simulate,
		submit,
		setMode: (value: 'entry' | 'exit') => resetPositionInput(() => setMode(value)),
		setSide: (value: 'YES' | 'NO') => resetPositionInput(() => setSide(value)),
		setAmount: (value: string) => resetPositionInput(() => setAmount(value)),
		setSlippage: (value: string) => resetPositionInput(() => setSlippage(value)),
		setTransactionValidityMinutes: (value: string) => resetPositionInput(() => setTransactionValidityMinutes(value)),
	}
}
