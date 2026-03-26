import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { claimSecurityPoolAuctionProceeds, createChildUniverseFromSecurityPool, finalizeSecurityPoolTruthAuction, forkZoltarWithOwnEscalation, initiateSecurityPoolFork, loadForkAuctionDetails, migrateEscalationDeposits, migrateRepToZoltarFromSecurityPool, migrateSecurityVault, refundTruthAuctionBid, startTruthAuctionForSecurityPool, submitTruthAuctionBid } from '../contracts.js'
import { createReadClient, createWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput, parseBigIntListInput, parseReportingOutcomeInput, parseReportingOutcomeListInput } from '../lib/inputs.js'
import { getDefaultForkAuctionFormState, parseBigIntInput } from '../lib/marketForm.js'
import { setSignalValue, updateSignalValue } from '../lib/signals.js'
import type { ForkAuctionFormState } from '../types/app.js'
import type { ForkAuctionActionResult, ForkAuctionDetails } from '../types/contracts.js'

type UseForkAuctionOperationsParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useForkAuctionOperations({ accountAddress, onTransaction, refreshState }: UseForkAuctionOperationsParameters) {
	const forkAuctionDetails = useSignal<ForkAuctionDetails | undefined>(undefined)
	const forkAuctionError = useSignal<string | undefined>(undefined)
	const forkAuctionForm = useSignal<ForkAuctionFormState>(getDefaultForkAuctionFormState())
	const forkAuctionResult = useSignal<ForkAuctionActionResult | undefined>(undefined)
	const loadingForkAuctionDetails = useSignal(false)

	const loadForkAuction = async () => {
		setSignalValue(loadingForkAuctionDetails, true)
		setSignalValue(forkAuctionError, undefined)
		try {
			const securityPoolAddress = parseAddressInput(forkAuctionForm.value.securityPoolAddress, 'Security pool address')
			const details = await loadForkAuctionDetails(createReadClient(), securityPoolAddress)
			setSignalValue(forkAuctionDetails, details)
		} catch (error) {
			setSignalValue(forkAuctionDetails, undefined)
			setSignalValue(forkAuctionError, getErrorMessage(error, 'Failed to load fork and auction details'))
		} finally {
			setSignalValue(loadingForkAuctionDetails, false)
		}
	}

	const runForkAuctionAction = async (action: (walletAddress: Address, details: ForkAuctionDetails) => Promise<ForkAuctionActionResult>, errorFallback: string) => {
		const ethereum = getRequiredInjectedEthereum()
		if (ethereum === undefined) {
			setSignalValue(forkAuctionError, 'No injected wallet found')
			return
		}
		if (accountAddress === undefined) {
			setSignalValue(forkAuctionError, 'Connect a wallet before using fork or truth auction actions')
			return
		}

		try {
			setSignalValue(forkAuctionError, undefined)
			setSignalValue(forkAuctionResult, undefined)
			const details = forkAuctionDetails.value ?? await loadForkAuctionDetails(createReadClient(), parseAddressInput(forkAuctionForm.value.securityPoolAddress, 'Security pool address'))
			const result = await action(accountAddress, details)
			setSignalValue(forkAuctionResult, result)
			onTransaction(result.hash)
			await refreshState()
			const updatedDetails = await loadForkAuctionDetails(createReadClient(), details.securityPoolAddress)
			setSignalValue(forkAuctionDetails, updatedDetails)
		} catch (error) {
			setSignalValue(forkAuctionError, getErrorMessage(error, errorFallback))
		}
	}

	const forkWithOwnEscalation = async () =>
		await runForkAuctionAction(async (walletAddress, details) => await forkZoltarWithOwnEscalation(createWriteClient(getRequiredInjectedEthereum(), walletAddress), details.securityPoolAddress, details.universeId), 'Failed to fork with own escalation game')

	const initiateFork = async () =>
		await runForkAuctionAction(async (walletAddress, details) => await initiateSecurityPoolFork(createWriteClient(getRequiredInjectedEthereum(), walletAddress), details.securityPoolAddress, details.universeId), 'Failed to initiate security pool fork')

	const createChildUniverse = async () =>
		await runForkAuctionAction(async (walletAddress, details) => await createChildUniverseFromSecurityPool(createWriteClient(getRequiredInjectedEthereum(), walletAddress), details.securityPoolAddress, details.universeId, parseReportingOutcomeInput(forkAuctionForm.value.selectedOutcome)), 'Failed to create child universe')

	const migrateRepToZoltar = async () =>
		await runForkAuctionAction(async (walletAddress, details) => await migrateRepToZoltarFromSecurityPool(createWriteClient(getRequiredInjectedEthereum(), walletAddress), details.securityPoolAddress, details.universeId, parseReportingOutcomeListInput(forkAuctionForm.value.repMigrationOutcomes, 'REP migration outcomes')), 'Failed to migrate REP to Zoltar')

	const migrateVault = async () =>
		await runForkAuctionAction(async (walletAddress, details) => await migrateSecurityVault(createWriteClient(getRequiredInjectedEthereum(), walletAddress), details.securityPoolAddress, details.universeId, parseReportingOutcomeInput(forkAuctionForm.value.selectedOutcome)), 'Failed to migrate vault')

	const migrateEscalation = async () =>
		await runForkAuctionAction(async (walletAddress, details) => {
			const vaultAddress = forkAuctionForm.value.claimVaultAddress.trim() === '' ? walletAddress : parseAddressInput(forkAuctionForm.value.claimVaultAddress, 'Vault address')
			return await migrateEscalationDeposits(createWriteClient(getRequiredInjectedEthereum(), walletAddress), details.securityPoolAddress, details.universeId, vaultAddress, parseReportingOutcomeInput(forkAuctionForm.value.selectedOutcome), parseBigIntListInput(forkAuctionForm.value.depositIndexes, 'Deposit indexes'))
		}, 'Failed to migrate escalation deposits')

	const startTruthAuction = async () =>
		await runForkAuctionAction(async (walletAddress, details) => await startTruthAuctionForSecurityPool(createWriteClient(getRequiredInjectedEthereum(), walletAddress), details.securityPoolAddress, details.universeId), 'Failed to start truth auction')

	const submitBid = async () =>
		await runForkAuctionAction(async (walletAddress, details) => {
			if (details.truthAuctionAddress === undefined) throw new Error('Truth auction not available')
			return await submitTruthAuctionBid(createWriteClient(getRequiredInjectedEthereum(), walletAddress), details.securityPoolAddress, details.universeId, details.truthAuctionAddress, parseBigIntInput(forkAuctionForm.value.bidTick, 'Bid tick'), parseBigIntInput(forkAuctionForm.value.bidAmount, 'Bid amount'))
		}, 'Failed to submit truth auction bid')

	const refundLosingBids = async () =>
		await runForkAuctionAction(async (walletAddress, details) => {
			if (details.truthAuctionAddress === undefined) throw new Error('Truth auction not available')
			return await refundTruthAuctionBid(createWriteClient(getRequiredInjectedEthereum(), walletAddress), details.securityPoolAddress, details.universeId, details.truthAuctionAddress, parseBigIntInput(forkAuctionForm.value.refundTick, 'Refund tick'), parseBigIntInput(forkAuctionForm.value.refundBidIndex, 'Refund bid index'))
		}, 'Failed to refund losing bids')

	const finalizeTruthAuction = async () =>
		await runForkAuctionAction(async (walletAddress, details) => await finalizeSecurityPoolTruthAuction(createWriteClient(getRequiredInjectedEthereum(), walletAddress), details.securityPoolAddress, details.universeId), 'Failed to finalize truth auction')

	const claimAuctionProceeds = async () =>
		await runForkAuctionAction(async (walletAddress, details) => {
			const vaultAddress = forkAuctionForm.value.claimVaultAddress.trim() === '' ? walletAddress : parseAddressInput(forkAuctionForm.value.claimVaultAddress, 'Vault address')
			return await claimSecurityPoolAuctionProceeds(createWriteClient(getRequiredInjectedEthereum(), walletAddress), details.securityPoolAddress, details.universeId, vaultAddress, parseBigIntInput(forkAuctionForm.value.bidTick, 'Bid tick'), parseBigIntInput(forkAuctionForm.value.bidIndex, 'Bid index'))
		}, 'Failed to claim auction proceeds')

	return {
		claimAuctionProceeds,
		createChildUniverse,
		forkAuctionDetails: forkAuctionDetails.value,
		forkAuctionError: forkAuctionError.value,
		forkAuctionForm: forkAuctionForm.value,
		forkAuctionResult: forkAuctionResult.value,
		forkWithOwnEscalation,
		initiateFork,
		loadForkAuction,
		loadingForkAuctionDetails: loadingForkAuctionDetails.value,
		migrateEscalation: migrateEscalation,
		migrateRepToZoltar,
		migrateVault,
		refundLosingBids,
		setForkAuctionForm: (updater: (current: ForkAuctionFormState) => ForkAuctionFormState) => {
			updateSignalValue(forkAuctionForm, updater)
		},
		startTruthAuction,
		submitBid,
		finalizeTruthAuction,
	}
}
