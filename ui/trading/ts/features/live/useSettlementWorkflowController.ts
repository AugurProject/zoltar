import type { Address, Hash, WalletClient } from '@zoltar/shared/ethereum'
import { createExclusiveWorkflowGuard, createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { waitForSubmittedTransactionReceipt } from '@zoltar/ui-core-shared/lib/transactionReceipt.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { publicErrorMessage, type LiveMarket, type SettlementOperation, type ShareOutcome } from '../../protocol/live.js'
import type { LiveSettlementServices } from '../LiveSettlementControls.js'
import { approvalFailureTransition, broadcastUncertainMessage, failedSubmissionTransition, positionControlsWorkflowLocked, type GuardedWalletWrite } from '../liveTradingControllerHelpers.js'
import type { BalanceState, TransactionState } from './liveTradingTypes.js'
import { settlementQuoteCanSubmit, settlementQuoteMatchesInputs, type SettlementQuote } from './settlementQuote.js'

export function useSettlementWorkflowController({
	configuration,
	market,
	account,
	walletClient,
	externallyLocked,
	balanceState,
	operation,
	parsedAmount,
	sourceOutcome,
	targetOutcomeIndexes,
	inputBlocker,
	approvalRequired,
	contextKey,
	refresh,
	refreshBalancesAfterApproval,
	onKnownReceipt,
	walletContextIsCurrent,
	executeWithCurrentWalletContext,
	createGuardedWalletWrite,
	onWorkflowLockChange,
	onMigrationConfirmed,
	services,
}: {
	configuration: DeploymentConfiguration
	market: LiveMarket
	account: Address | undefined
	walletClient: WalletClient | undefined
	externallyLocked: boolean
	balanceState: BalanceState
	operation: SettlementOperation
	parsedAmount: bigint | undefined
	sourceOutcome: ShareOutcome
	targetOutcomeIndexes: readonly bigint[]
	inputBlocker: string | undefined
	approvalRequired: boolean
	contextKey: string
	refresh(): Promise<void>
	refreshBalancesAfterApproval(label: string, market: LiveMarket, account: Address): Promise<'ready' | 'refresh-error' | 'context-changed'>
	onKnownReceipt(): void
	walletContextIsCurrent(account: Address): boolean
	executeWithCurrentWalletContext<T>(account: Address, networkFailure: string, accountFailure: string, action: () => Promise<T>): Promise<T>
	createGuardedWalletWrite(account: Address, networkFailure: string, accountFailure: string): GuardedWalletWrite
	onWorkflowLockChange(locked: boolean): void
	onMigrationConfirmed(): void
	services: LiveSettlementServices
}) {
	const [quote, setQuote] = useState<SettlementQuote>()
	const [state, setState] = useState<TransactionState>('idle')
	const [transactionHash, setTransactionHash] = useState<Hash>()
	const [error, setError] = useState<string>()
	const [receiptWarning, setReceiptWarning] = useState<string>()
	const workflow = useRef(createExclusiveWorkflowGuard()).current
	const simulationRequests = useRef(createLatestRequestGuard()).current
	const inputRevision = useRef(0)
	const mounted = useRef(true)
	const preserveConfirmedOnNextInvalidation = useRef(false)
	const matches = settlementQuoteMatchesInputs(quote, inputRevision.current, market, operation, parsedAmount, sourceOutcome, targetOutcomeIndexes, account, walletClient)
	const actionableQuote = !approvalRequired && settlementQuoteCanSubmit(balanceState, inputBlocker, matches) ? quote : undefined
	const submitContext = useRef({ balanceState, inputBlocker, actionableQuote })
	submitContext.current = { balanceState, inputBlocker, actionableQuote }
	const workflowLocked = externallyLocked || positionControlsWorkflowLocked(state, receiptWarning)

	function invalidateInputs() {
		if (receiptWarning !== undefined) return
		inputRevision.current++
		simulationRequests.invalidate()
		setQuote(undefined)
		setError(undefined)
		if (!workflow.isActive()) {
			const preserveConfirmed = preserveConfirmedOnNextInvalidation.current
			preserveConfirmedOnNextInvalidation.current = false
			setTransactionHash(undefined)
			setState(current => (preserveConfirmed && current === 'confirmed' ? current : 'idle'))
		}
	}

	useEffect(() => invalidateInputs(), [contextKey])
	useEffect(() => {
		if (receiptWarning !== undefined) return
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!workflow.isActive()) setState(current => (current === 'confirmed' || current === 'approval-confirmed' ? current : 'idle'))
	}, [balanceState, receiptWarning])
	useEffect(
		() => () => {
			mounted.current = false
			simulationRequests.invalidate()
			if (workflow.isActive()) workflow.finish()
			onWorkflowLockChange(false)
		},
		[onWorkflowLockChange],
	)

	async function simulateCurrent(parameters: Readonly<{ validityMinutes: bigint | undefined; slippageBps: bigint | undefined }>) {
		if (walletClient === undefined || account === undefined || inputBlocker !== undefined) return
		const request = simulationRequests.begin()
		const revision = inputRevision.current
		setState('simulating')
		setTransactionHash(undefined)
		setError(undefined)
		try {
			let operationParameters: Readonly<{ amount?: bigint; validityMinutes?: bigint; slippageBps?: bigint; sourceOutcome?: ShareOutcome; targetOutcomeIndexes?: readonly bigint[] }> = {}
			if (operation === 'redeem-complete-set' && parsedAmount !== undefined && parameters.slippageBps !== undefined && parameters.validityMinutes !== undefined) operationParameters = { amount: parsedAmount, validityMinutes: parameters.validityMinutes, slippageBps: parameters.slippageBps }
			else if (operation === 'migrate-shares') operationParameters = { sourceOutcome, targetOutcomeIndexes }
			const simulation = await services.simulate(walletClient, configuration, market, account, operation, operationParameters)
			if (!mounted.current || !simulationRequests.isCurrent(request) || inputRevision.current !== revision) return
			setQuote({ ...simulation, account, walletClient, inputRevision: revision })
			setState('ready')
		} catch (caught) {
			if (!mounted.current || !simulationRequests.isCurrent(request) || inputRevision.current !== revision) return
			setState('error')
			setError(publicErrorMessage(caught, 'Settlement simulation failed'))
		}
	}

	async function submitCurrent() {
		const selectedQuote = actionableQuote
		if (walletClient === undefined || account === undefined || selectedQuote === undefined || externallyLocked || !workflow.begin()) return
		onWorkflowLockChange(true)
		setState('preparing')
		setError(undefined)
		setReceiptWarning(undefined)
		setTransactionHash(undefined)
		let broadcastHash: Hash | undefined
		let receiptKnown = false
		let keepLocked = false
		try {
			await executeWithCurrentWalletContext(account, 'Wallet network changed; reconnect and simulate again', 'Wallet account changed; reconnect and simulate again', async () => undefined)
			const current = submitContext.current
			if (current.balanceState !== 'ready' || current.inputBlocker !== undefined || current.actionableQuote !== selectedQuote) throw new Error('Settlement inputs or balances changed; simulate again')
			const guardedWrite = createGuardedWalletWrite(account, 'Wallet network changed during settlement revalidation; reconnect and simulate again', 'Wallet account changed during settlement revalidation; reconnect and simulate again')
			broadcastHash = await services.submit(
				walletClient,
				configuration,
				account,
				selectedQuote,
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
			if (receipt.status === 'reverted') throw new Error('Settlement transaction reverted')
			setQuote(undefined)
			setReceiptWarning(undefined)
			setState('confirmed')
			await refresh()
			if (selectedQuote.operation === 'migrate-shares' && mounted.current) {
				preserveConfirmedOnNextInvalidation.current = true
				onMigrationConfirmed()
			}
		} catch (caught) {
			if (!mounted.current) return
			if (broadcastHash !== undefined && !receiptKnown) {
				keepLocked = true
				setState('pending')
				setError(undefined)
				setReceiptWarning(broadcastUncertainMessage('Settlement transaction', broadcastHash))
			} else {
				const failure = failedSubmissionTransition(caught, 'Settlement transaction failed')
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

	async function approveCompleteSetRouter() {
		if (walletClient === undefined || account === undefined || !approvalRequired || externallyLocked || !workflow.begin()) return
		onWorkflowLockChange(true)
		setState('preparing')
		setError(undefined)
		setReceiptWarning(undefined)
		setTransactionHash(undefined)
		let broadcastHash: Hash | undefined
		let receiptKnown = false
		let keepLocked = false
		try {
			broadcastHash = await createGuardedWalletWrite(
				account,
				'Wallet network changed; reconnect before approving',
				'Wallet account changed; reconnect before approving',
			)(async () => {
				if (mounted.current) setState('approval')
				return await services.approveRouter(walletClient, market, configuration, account)
			})
			if (!mounted.current) return
			setTransactionHash(broadcastHash)
			setState('approval-pending')
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
			if (receipt.status === 'reverted') {
				if (!walletContextIsCurrent(account)) {
					setState('error')
					setError('Wallet context changed while the share-token approval was pending. Approval transaction reverted.')
					return
				}
				throw new Error('Approval transaction reverted')
			}
			setState('approval-confirmed')
			if (!walletContextIsCurrent(account)) return
			const refreshResult = await refreshBalancesAfterApproval('Share-token approval', market, account)
			if (!mounted.current) return
			if (refreshResult === 'context-changed') setError('Wallet context changed while approved balances were refreshing. Reconnect to continue.')
		} catch (caught) {
			if (!mounted.current) return
			if (!walletContextIsCurrent(account)) {
				if (broadcastHash !== undefined && !receiptKnown) {
					keepLocked = true
					setState('approval-pending')
					setError(undefined)
					setReceiptWarning(broadcastUncertainMessage('Share-token approval', broadcastHash))
				} else {
					setState('error')
					setError('Wallet context changed while the share-token approval was pending. Reconnect to continue.')
				}
				return
			}
			const failure = approvalFailureTransition('Share-token approval', broadcastHash, receiptKnown, caught, 'Approval failed')
			keepLocked = failure.keepLocked
			setState(failure.state === 'pending' ? 'approval-pending' : failure.state)
			setError(failure.message)
			setReceiptWarning(failure.warning)
		} finally {
			workflow.finish()
			if (!keepLocked) onWorkflowLockChange(false)
		}
	}

	return { quote, state, transactionHash, error, receiptWarning, actionableQuote, workflowLocked, invalidateInputs, simulateCurrent, submitCurrent, approveCompleteSetRouter }
}
