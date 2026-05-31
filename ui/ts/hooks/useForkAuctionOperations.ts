import { useSignal } from '@preact/signals'
import { useFormState } from './useFormState.js'
import { useLoadController } from './useLoadController.js'
import type { Address } from 'viem'
import {
	claimSecurityPoolAuctionProceeds,
	createChildUniverseFromSecurityPool,
	finalizeSecurityPoolTruthAuction,
	forkUniverseDirectly,
	forkZoltarWithOwnEscalation,
	initiateSecurityPoolFork,
	loadForkAuctionDetails,
	migrateEscalationDeposits,
	migrateRepToZoltarFromSecurityPool,
	migrateSecurityVault,
	refundTruthAuctionBid,
	startTruthAuctionForSecurityPool,
	submitTruthAuctionBid,
} from '../contracts.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { getTruthAuctionBidGuardMessage } from '../lib/forkAuction.js'
import { getReportingOutcomeKey, parseAddressInput, parseBigIntListInput, parseReportingOutcomeInput, parseReportingOutcomeListInput, resolveOptionalAddressInput } from '../lib/inputs.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../lib/actionFeedback.js'
import { requireDefined } from '../lib/required.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import { getDefaultForkAuctionFormState, parseBigIntInput } from '../lib/marketForm.js'
import type { ForkAuctionFormState, WriteOperationsParameters } from '../types/app.js'
import type { ActionFeedback } from '../types/components.js'
import type { ForkAuctionActionResult, ForkAuctionDetails, ReportingOutcomeKey } from '../types/contracts.js'

type UseForkAuctionOperationsParameters = WriteOperationsParameters

export function useForkAuctionOperations({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseForkAuctionOperationsParameters) {
	const forkAuctionDetails = useSignal<ForkAuctionDetails | undefined>(undefined)
	const forkAuctionActiveAction = useSignal<ForkAuctionActionResult['action'] | undefined>(undefined)
	const forkAuctionFeedback = useSignal<ActionFeedback<ForkAuctionActionResult['action']> | undefined>(undefined)
	const forkAuctionError = useSignal<string | undefined>(undefined)
	const { state: forkAuctionForm, setState: setForkAuctionForm } = useFormState<ForkAuctionFormState>(getDefaultForkAuctionFormState())
	const forkAuctionResult = useSignal<ForkAuctionActionResult | undefined>(undefined)
	const forkAuctionLoad = useLoadController()
	const getPendingTitle = (actionName: ForkAuctionActionResult['action']) => {
		if (actionName === 'claimAuctionProceeds') return 'Settle Finalized Bid'
		return actionName.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase())
	}
	const getSuccessTitle = (actionName: ForkAuctionActionResult['action']) => `${getPendingTitle(actionName)} submitted`
	const getFailureTitle = (actionName: ForkAuctionActionResult['action']) => `${getPendingTitle(actionName)} failed`

	const loadForkAuction = async () => {
		await forkAuctionLoad.run({
			onStart: () => {
				forkAuctionError.value = undefined
			},
			load: async () => {
				const securityPoolAddress = parseAddressInput(forkAuctionForm.value.securityPoolAddress, 'Security pool address')
				return await loadForkAuctionDetails(createConnectedReadClient(), securityPoolAddress)
			},
			onSuccess: details => {
				forkAuctionDetails.value = details
			},
			onError: error => {
				forkAuctionDetails.value = undefined
				forkAuctionError.value = getErrorMessage(error, 'Failed to load fork and auction details')
			},
		})
	}

	const runForkAuctionAction = async (actionName: ForkAuctionActionResult['action'], action: (walletAddress: Address, details: ForkAuctionDetails) => Promise<ForkAuctionActionResult>, errorFallback: string) => {
		try {
			forkAuctionActiveAction.value = actionName
			forkAuctionFeedback.value = createPendingActionFeedback(actionName, getPendingTitle(actionName))
			await runWriteAction(
				{
					...buildWriteActionConfig({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, refreshState }, forkAuctionError, 'Connect a wallet before using fork or truth auction actions'),
					onRefreshError: (message, hash) => {
						forkAuctionFeedback.value = createWarningActionFeedback(actionName, getSuccessTitle(actionName), message, hash)
					},
					onWriteError: message => {
						forkAuctionFeedback.value = createErrorActionFeedback(actionName, getFailureTitle(actionName), message)
					},
				},
				async walletAddress => {
					forkAuctionResult.value = undefined
					const details = forkAuctionDetails.value ?? (await loadForkAuctionDetails(createConnectedReadClient(), parseAddressInput(forkAuctionForm.value.securityPoolAddress, 'Security pool address')))
					return await action(walletAddress, details)
				},
				errorFallback,
				async result => {
					forkAuctionResult.value = result
					forkAuctionFeedback.value = createSuccessActionFeedback(actionName, getSuccessTitle(actionName), result.hash)
					forkAuctionDetails.value = await loadForkAuctionDetails(createConnectedReadClient(), result.securityPoolAddress)
				},
			)
		} finally {
			forkAuctionActiveAction.value = undefined
		}
	}

	const forkWithOwnEscalation = async () =>
		await runForkAuctionAction('forkWithOwnEscalation', async (walletAddress, details) => await forkZoltarWithOwnEscalation(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId), 'Failed to fork with own escalation game')

	const initiateFork = async () => await runForkAuctionAction('initiateFork', async (walletAddress, details) => await initiateSecurityPoolFork(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId), 'Failed to initiate security pool fork')

	const createChildUniverse = async (outcome: ReportingOutcomeKey | bigint) =>
		await runForkAuctionAction('createChildUniverse', async (walletAddress, details) => await createChildUniverseFromSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, getReportingOutcomeKey(outcome)), 'Failed to create child universe')

	const migrateRepToZoltar = async (outcomesOverride?: ReportingOutcomeKey[]) =>
		await runForkAuctionAction(
			'migrateRepToZoltar',
			async (walletAddress, details) => await migrateRepToZoltarFromSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, outcomesOverride ?? parseReportingOutcomeListInput(forkAuctionForm.value.repMigrationOutcomes, 'REP migration outcomes')),
			'Failed to migrate REP to Zoltar',
		)

	const migrateVault = async () =>
		await runForkAuctionAction('migrateVault', async (walletAddress, details) => await migrateSecurityVault(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, parseReportingOutcomeInput(forkAuctionForm.value.selectedOutcome)), 'Failed to migrate vault')

	const migrateEscalation = async ({ depositIndexes, outcome, vaultAddress }: { depositIndexes?: bigint[]; outcome?: ReportingOutcomeKey; vaultAddress?: Address } = {}) =>
		await runForkAuctionAction(
			'migrateEscalationDeposits',
			async (walletAddress, details) => {
				const resolvedVaultAddress = vaultAddress ?? resolveOptionalAddressInput(forkAuctionForm.value.vaultAddress, walletAddress, 'Vault address')
				return await migrateEscalationDeposits(
					createWalletWriteClient(walletAddress, { onTransactionSubmitted }),
					details.securityPoolAddress,
					details.universeId,
					resolvedVaultAddress,
					outcome ?? parseReportingOutcomeInput(forkAuctionForm.value.selectedOutcome),
					depositIndexes ?? parseBigIntListInput(forkAuctionForm.value.depositIndexes, 'Deposit indexes'),
				)
			},
			'Failed to migrate escalation deposits',
		)

	const startTruthAuction = async () => await runForkAuctionAction('startTruthAuction', async (walletAddress, details) => await startTruthAuctionForSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId), 'Failed to start truth auction')

	const submitBid = async () =>
		await runForkAuctionAction(
			'submitBid',
			async (walletAddress, details) => {
				const walletEthBalance = await createConnectedReadClient().getBalance({ address: walletAddress })
				const bidGuardMessage = getTruthAuctionBidGuardMessage({
					accountAddress: walletAddress,
					currentTimestamp: details.currentTime,
					isMainnet: true,
					submitBidAmountInput: forkAuctionForm.value.submitBidAmount,
					truthAuction: details.truthAuction,
					walletEthBalance,
				})
				if (bidGuardMessage !== undefined) throw new Error(bidGuardMessage)
				const truthAuctionAddress = requireDefined(details.truthAuctionAddress, 'Truth auction not available')
				return await submitTruthAuctionBid(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, truthAuctionAddress, parseBigIntInput(forkAuctionForm.value.submitBidTick, 'Bid tick'), parseBigIntInput(forkAuctionForm.value.submitBidAmount, 'Bid amount'))
			},
			'Failed to submit truth auction bid',
		)

	const refundLosingBids = async () =>
		await runForkAuctionAction(
			'refundLosingBids',
			async (walletAddress, details) => {
				const truthAuctionAddress = requireDefined(details.truthAuctionAddress, 'Truth auction not available')
				return await refundTruthAuctionBid(
					createWalletWriteClient(walletAddress, { onTransactionSubmitted }),
					details.securityPoolAddress,
					details.universeId,
					truthAuctionAddress,
					parseBigIntInput(forkAuctionForm.value.refundTick, 'Refund tick'),
					parseBigIntInput(forkAuctionForm.value.refundBidIndex, 'Refund bid index'),
				)
			},
			'Failed to refund losing bids',
		)

	const finalizeTruthAuction = async () => await runForkAuctionAction('finalizeTruthAuction', async (walletAddress, details) => await finalizeSecurityPoolTruthAuction(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId), 'Failed to finalize truth auction')

	const claimAuctionProceeds = async () =>
		await runForkAuctionAction(
			'claimAuctionProceeds',
			async (walletAddress, details) => {
				const bidderAddress = resolveOptionalAddressInput(forkAuctionForm.value.settlementAddress, walletAddress, 'Bidder address')
				return await claimSecurityPoolAuctionProceeds(
					createWalletWriteClient(walletAddress, { onTransactionSubmitted }),
					details.securityPoolAddress,
					details.universeId,
					bidderAddress,
					parseBigIntInput(forkAuctionForm.value.claimBidTick, 'Settlement bid tick'),
					parseBigIntInput(forkAuctionForm.value.claimBidIndex, 'Settlement bid index'),
				)
			},
			'Failed to settle finalized bid',
		)

	const forkUniverse = async () =>
		await runForkAuctionAction(
			'forkUniverse',
			async (walletAddress, details) =>
				await forkUniverseDirectly(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), parseBigIntInput(forkAuctionForm.value.directForkUniverseId, 'Fork universe ID'), parseBigIntInput(forkAuctionForm.value.directForkQuestionId, 'Fork question ID'), details.securityPoolAddress),
			'Failed to fork universe directly',
		)

	return {
		claimAuctionProceeds,
		createChildUniverse,
		forkAuctionActiveAction: forkAuctionActiveAction.value,
		forkAuctionDetails: forkAuctionDetails.value,
		forkAuctionError: forkAuctionError.value,
		forkAuctionFeedback: forkAuctionFeedback.value,
		forkAuctionForm: forkAuctionForm.value,
		forkAuctionResult: forkAuctionResult.value,
		forkUniverse,
		forkWithOwnEscalation,
		initiateFork,
		loadForkAuction,
		loadingForkAuctionDetails: forkAuctionLoad.isLoading.value,
		migrateEscalation: migrateEscalation,
		migrateRepToZoltar,
		migrateVault,
		refundLosingBids,
		setForkAuctionForm,
		startTruthAuction,
		submitBid,
		finalizeTruthAuction,
	}
}
