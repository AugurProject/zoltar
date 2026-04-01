import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { claimSecurityPoolAuctionProceeds, createChildUniverseFromSecurityPool, finalizeSecurityPoolTruthAuction, forkUniverseDirectly, forkZoltarWithOwnEscalation, initiateSecurityPoolFork, loadForkAuctionDetails, migrateEscalationDeposits, migrateRepToZoltarFromSecurityPool, migrateSecurityVault, refundTruthAuctionBid, startTruthAuctionForSecurityPool, submitTruthAuctionBid, withdrawTruthAuctionBids } from '../contracts.js'
import { createReadClient, createWalletWriteClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { runWriteAction } from '../lib/writeAction.js'
import { parseAddressInput, parseBigIntListInput, parseReportingOutcomeInput, parseReportingOutcomeListInput } from '../lib/inputs.js'
import { getDefaultForkAuctionFormState, parseBigIntInput } from '../lib/marketForm.js'
import type { ForkAuctionFormState } from '../types/app.js'
import type { ForkAuctionActionResult, ForkAuctionDetails, ReportingOutcomeKey } from '../types/contracts.js'

type UseForkAuctionOperationsParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

function getReportingOutcomeKey(outcome: ReportingOutcomeKey | bigint): ReportingOutcomeKey {
	if (typeof outcome !== 'bigint') return outcome
	switch (outcome) {
		case 0n:
			return 'invalid'
		case 1n:
			return 'yes'
		case 2n:
			return 'no'
		default:
			throw new Error(`Unsupported child universe outcome index: ${ outcome.toString() }`)
	}
}

export function useForkAuctionOperations({ accountAddress, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseForkAuctionOperationsParameters) {
	const forkAuctionDetails = useSignal<ForkAuctionDetails | undefined>(undefined)
	const forkAuctionError = useSignal<string | undefined>(undefined)
	const forkAuctionForm = useSignal<ForkAuctionFormState>(getDefaultForkAuctionFormState())
	const forkAuctionResult = useSignal<ForkAuctionActionResult | undefined>(undefined)
	const loadingForkAuctionDetails = useSignal(false)

	const loadForkAuction = async () => {
		loadingForkAuctionDetails.value = true
		forkAuctionError.value = undefined
		try {
			const securityPoolAddress = parseAddressInput(forkAuctionForm.value.securityPoolAddress, 'Security pool address')
			const details = await loadForkAuctionDetails(createReadClient(), securityPoolAddress)
			forkAuctionDetails.value = details
		} catch (error) {
			forkAuctionDetails.value = undefined
			forkAuctionError.value = getErrorMessage(error, 'Failed to load fork and auction details')
		} finally {
			loadingForkAuctionDetails.value = false
		}
	}

	const runForkAuctionAction = async (action: (walletAddress: Address, details: ForkAuctionDetails) => Promise<ForkAuctionActionResult>, errorFallback: string) =>
		await runWriteAction(
			{
				accountAddress,
				missingWalletMessage: 'Connect a wallet before using fork or truth auction actions',
				onTransaction,
				onTransactionFinished,
				onTransactionRequested,
				refreshState,
				setErrorMessage: message => {
					forkAuctionError.value = message
				},
			},
			async walletAddress => {
				forkAuctionResult.value = undefined
				const details = forkAuctionDetails.value ?? await loadForkAuctionDetails(createReadClient(), parseAddressInput(forkAuctionForm.value.securityPoolAddress, 'Security pool address'))
				return await action(walletAddress, details)
			},
			errorFallback,
			async result => {
				forkAuctionResult.value = result
				forkAuctionDetails.value = await loadForkAuctionDetails(createReadClient(), result.securityPoolAddress)
			},
		)

	const forkWithOwnEscalation = async () => await runForkAuctionAction(async (walletAddress, details) => await forkZoltarWithOwnEscalation(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId), 'Failed to fork with own escalation game')

	const initiateFork = async () => await runForkAuctionAction(async (walletAddress, details) => await initiateSecurityPoolFork(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId), 'Failed to initiate security pool fork')

	const createChildUniverse = async (outcome: ReportingOutcomeKey | bigint) => await runForkAuctionAction(async (walletAddress, details) => await createChildUniverseFromSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, getReportingOutcomeKey(outcome)), 'Failed to create child universe')

	const migrateRepToZoltar = async () => await runForkAuctionAction(async (walletAddress, details) => await migrateRepToZoltarFromSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, parseReportingOutcomeListInput(forkAuctionForm.value.repMigrationOutcomes, 'REP migration outcomes')), 'Failed to migrate REP to Zoltar')

	const migrateVault = async () => await runForkAuctionAction(async (walletAddress, details) => await migrateSecurityVault(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, parseReportingOutcomeInput(forkAuctionForm.value.selectedOutcome)), 'Failed to migrate vault')

	const migrateEscalation = async () =>
		await runForkAuctionAction(async (walletAddress, details) => {
			const vaultAddress = forkAuctionForm.value.claimVaultAddress.trim() === '' ? walletAddress : parseAddressInput(forkAuctionForm.value.claimVaultAddress, 'Vault address')
			return await migrateEscalationDeposits(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, vaultAddress, parseReportingOutcomeInput(forkAuctionForm.value.selectedOutcome), parseBigIntListInput(forkAuctionForm.value.depositIndexes, 'Deposit indexes'))
		}, 'Failed to migrate escalation deposits')

	const startTruthAuction = async () => await runForkAuctionAction(async (walletAddress, details) => await startTruthAuctionForSecurityPool(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId), 'Failed to start truth auction')

	const submitBid = async () =>
		await runForkAuctionAction(async (walletAddress, details) => {
			if (details.truthAuctionAddress === undefined) throw new Error('Truth auction not available')
			return await submitTruthAuctionBid(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, details.truthAuctionAddress, parseBigIntInput(forkAuctionForm.value.bidTick, 'Bid tick'), parseBigIntInput(forkAuctionForm.value.bidAmount, 'Bid amount'))
		}, 'Failed to submit truth auction bid')

	const refundLosingBids = async () =>
		await runForkAuctionAction(async (walletAddress, details) => {
			if (details.truthAuctionAddress === undefined) throw new Error('Truth auction not available')
			return await refundTruthAuctionBid(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, details.truthAuctionAddress, parseBigIntInput(forkAuctionForm.value.refundTick, 'Refund tick'), parseBigIntInput(forkAuctionForm.value.refundBidIndex, 'Refund bid index'))
		}, 'Failed to refund losing bids')

	const finalizeTruthAuction = async () => await runForkAuctionAction(async (walletAddress, details) => await finalizeSecurityPoolTruthAuction(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId), 'Failed to finalize truth auction')

	const claimAuctionProceeds = async () =>
		await runForkAuctionAction(async (walletAddress, details) => {
			const vaultAddress = forkAuctionForm.value.claimVaultAddress.trim() === '' ? walletAddress : parseAddressInput(forkAuctionForm.value.claimVaultAddress, 'Vault address')
			return await claimSecurityPoolAuctionProceeds(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, vaultAddress, parseBigIntInput(forkAuctionForm.value.bidTick, 'Bid tick'), parseBigIntInput(forkAuctionForm.value.bidIndex, 'Bid index'))
		}, 'Failed to claim auction proceeds')

	const forkUniverse = async () => await runForkAuctionAction(async (walletAddress, details) => await forkUniverseDirectly(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), parseBigIntInput(forkAuctionForm.value.directForkUniverseId, 'Fork universe ID'), parseBigIntInput(forkAuctionForm.value.directForkQuestionId, 'Fork question ID'), details.securityPoolAddress), 'Failed to fork universe directly')

	const withdrawBids = async () =>
		await runForkAuctionAction(async (walletAddress, details) => {
			if (details.truthAuctionAddress === undefined) throw new Error('Truth auction not available')
			const withdrawFor = forkAuctionForm.value.withdrawForAddress.trim() === '' ? walletAddress : parseAddressInput(forkAuctionForm.value.withdrawForAddress, 'Withdraw-for address')
			return await withdrawTruthAuctionBids(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), details.securityPoolAddress, details.universeId, details.truthAuctionAddress, withdrawFor, parseBigIntInput(forkAuctionForm.value.withdrawTick, 'Withdraw tick'), parseBigIntInput(forkAuctionForm.value.withdrawBidIndex, 'Withdraw bid index'))
		}, 'Failed to withdraw bids')

	return {
		claimAuctionProceeds,
		createChildUniverse,
		forkAuctionDetails: forkAuctionDetails.value,
		forkAuctionError: forkAuctionError.value,
		forkAuctionForm: forkAuctionForm.value,
		forkAuctionResult: forkAuctionResult.value,
		forkUniverse,
		forkWithOwnEscalation,
		initiateFork,
		loadForkAuction,
		loadingForkAuctionDetails: loadingForkAuctionDetails.value,
		migrateEscalation: migrateEscalation,
		migrateRepToZoltar,
		migrateVault,
		refundLosingBids,
		setForkAuctionForm: (updater: (current: ForkAuctionFormState) => ForkAuctionFormState) => {
			forkAuctionForm.value = updater(forkAuctionForm.value)
		},
		startTruthAuction,
		submitBid,
		withdrawBids,
		finalizeTruthAuction,
	}
}
