import { reportOutcomeWithWalletViaVault } from '../../../protocol/reportingWalletFunding.js'
import { getReportingContributionFunding, getReportingWalletDepositAmount } from '../../../lib/reportingFunding.js'
import * as reportingCopy from '../../../copy/reporting.js'
import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { useFormState } from '@zoltar/ui-core-shared/hooks/useFormState.js'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { approveReportingRep, loadReportingDetails, reportOutcomeInSecurityPool, withdrawEscalationFromSecurityPool } from '../../../protocol/reporting.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { normalizeAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { formatAdditionalCurrencyBalance, formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { parseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { getDefaultReportingFormState, getDefaultReportingWithdrawDepositIndexesByOutcome } from '@zoltar/ui-zoltar-shared/lib/formDefaults.js'
import { parseRepAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { getEscalationDepositClaimAmount, getRemainingSelectedOutcomeContributionCapacity, previewReportingContribution } from '../lib/reportingDomain.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '@zoltar/ui-core-shared/transactions/actionFeedback.js'
import type { ActionFeedback } from '@zoltar/ui-core-shared/transactions/actionFeedback.js'
import { createReportingSuccessPresentation, createReportingTransactionIntent, createReportingWarningPresentation } from '../../reportingTransactionPresentations.js'
import { buildWriteActionConfig, runWriteAction, type WriteActionContext } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { refreshWalletStateOnly } from '@zoltar/ui-core-shared/lib/refreshState.js'
import type { ReportingFormState, ReportingWithdrawDepositIndexesByOutcome, WriteOperationsParameters } from '@zoltar/ui-zoltar-shared/types/app.js'
import type { ReportingActionResult, ReportingDetails, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'

type UseReportingOperationsParameters = WriteOperationsParameters
type ResolvedReportingOperationsParameters = UseReportingOperationsParameters & {
	selectedSecurityPoolAddress?: string
}

export type UseReportingOperationsDependencies = {
	reportOutcomeWithWalletViaVault?: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], securityPoolAddress: Address, outcome: ReportingOutcomeKey, reportAmount: bigint, depositAmount: bigint, onVaultFunded: () => void) => ReturnType<typeof reportOutcomeWithWalletViaVault>
	approveReportingRep: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], securityPoolAddress: Address, outcome: Parameters<typeof approveReportingRep>[2], amount: bigint) => ReturnType<typeof approveReportingRep>
	loadReportingDetails: (securityPoolAddress: Address, accountAddress: Address | undefined) => ReturnType<typeof loadReportingDetails>
	reportOutcomeInSecurityPool: (
		accountAddress: Address,
		callbacks: Parameters<typeof createWalletWriteClient>[1],
		securityPoolAddress: Address,
		outcome: Parameters<typeof reportOutcomeInSecurityPool>[2],
		amount: bigint,
		reviewAmount?: bigint,
		contributionFunding?: 'vault' | 'wallet',
	) => ReturnType<typeof reportOutcomeInSecurityPool>
	withdrawEscalationFromSecurityPool: (
		accountAddress: Address,
		callbacks: Parameters<typeof createWalletWriteClient>[1],
		securityPoolAddress: Address,
		outcome: Parameters<typeof withdrawEscalationFromSecurityPool>[2],
		depositIndexes: bigint[],
		claimAmount?: bigint,
	) => ReturnType<typeof withdrawEscalationFromSecurityPool>
}

const defaultUseReportingOperationsDependencies: UseReportingOperationsDependencies = {
	reportOutcomeWithWalletViaVault: async (accountAddress, callbacks, pool, outcome, amount, depositAmount, onVaultFunded) => await reportOutcomeWithWalletViaVault(createWalletWriteClient(accountAddress, callbacks), pool, outcome, amount, depositAmount, onVaultFunded),
	approveReportingRep: async (accountAddress, callbacks, securityPoolAddress, outcome, amount) => await approveReportingRep(createWalletWriteClient(accountAddress, callbacks), securityPoolAddress, outcome, amount),
	loadReportingDetails: async (securityPoolAddress, accountAddress) => await loadReportingDetails(createConnectedReadClient(), securityPoolAddress, accountAddress),
	reportOutcomeInSecurityPool: async (accountAddress, callbacks, securityPoolAddress, outcome, amount, reviewAmount, contributionFunding) => await reportOutcomeInSecurityPool(createWalletWriteClient(accountAddress, callbacks), securityPoolAddress, outcome, amount, reviewAmount, contributionFunding),
	withdrawEscalationFromSecurityPool: async (accountAddress, callbacks, securityPoolAddress, outcome, depositIndexes, claimAmount) => await withdrawEscalationFromSecurityPool(createWalletWriteClient(accountAddress, callbacks), securityPoolAddress, outcome, depositIndexes, claimAmount),
}

function getAvailableWithdrawDepositIndexes(details: ReportingDetails, outcome: ReportingOutcomeKey) {
	if (details.status !== 'active') return []
	const side = details.sides.find(candidate => candidate.key === outcome)
	return side?.userDeposits.map(deposit => deposit.depositIndex) ?? []
}

function filterAvailableWithdrawDepositIndexes(selectedDepositIndexes: bigint[], availableDepositIndexes: bigint[]) {
	return selectedDepositIndexes.filter(index => availableDepositIndexes.includes(index))
}

function sameSelectedWithdrawDepositIndexes(left: bigint[], right: bigint[]) {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameSelectedWithdrawDepositIndexesByOutcome(left: ReportingWithdrawDepositIndexesByOutcome, right: ReportingWithdrawDepositIndexesByOutcome) {
	return sameSelectedWithdrawDepositIndexes(left.invalid, right.invalid) && sameSelectedWithdrawDepositIndexes(left.yes, right.yes) && sameSelectedWithdrawDepositIndexes(left.no, right.no)
}

function pruneSelectedWithdrawDepositIndexesByOutcome(currentSelections: ReportingWithdrawDepositIndexesByOutcome, details: ReportingDetails) {
	if (details.status !== 'active') return getDefaultReportingWithdrawDepositIndexesByOutcome()

	return {
		invalid: filterAvailableWithdrawDepositIndexes(currentSelections.invalid, getAvailableWithdrawDepositIndexes(details, 'invalid')),
		yes: filterAvailableWithdrawDepositIndexes(currentSelections.yes, getAvailableWithdrawDepositIndexes(details, 'yes')),
		no: filterAvailableWithdrawDepositIndexes(currentSelections.no, getAvailableWithdrawDepositIndexes(details, 'no')),
	}
}

export function useReportingOperations(
	{ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, selectedSecurityPoolAddress }: ResolvedReportingOperationsParameters,
	dependencies: UseReportingOperationsDependencies = defaultUseReportingOperationsDependencies,
) {
	const reportingLoad = useLoadController()
	const reportingDetails = useSignal<ReportingDetails | undefined>(undefined)
	const reportingError = useSignal<string | undefined>(undefined)
	const { state: reportingForm, setState: setReportingForm } = useFormState<ReportingFormState>(getDefaultReportingFormState())
	const reportingActiveAction = useSignal<ReportingActionResult['action'] | undefined>(undefined)
	const reportingFeedback = useSignal<ActionFeedback<ReportingActionResult['action']> | undefined>(undefined)
	const reportingResult = useSignal<ReportingActionResult | undefined>(undefined)
	const nextReportingLoad = useRequestGuard()
	const effectiveReportingPoolAddressInput = selectedSecurityPoolAddress?.trim() === '' || selectedSecurityPoolAddress === undefined ? reportingForm.value.securityPoolAddress : selectedSecurityPoolAddress
	const currentReportingSelectionKey = normalizeAddress(effectiveReportingPoolAddressInput) ?? ''
	const currentReportingSelectionKeyRef = useRef(currentReportingSelectionKey)
	currentReportingSelectionKeyRef.current = currentReportingSelectionKey
	const currentAccountRef = useRef(accountAddress)
	currentAccountRef.current = accountAddress
	const previousAccountRef = useRef(accountAddress)

	const getPendingTitle = (actionName: ReportingActionResult['action']) => {
		if (actionName === 'approveReportingRep') return 'Approving REP for reporting'
		return actionName === 'reportOutcome' ? 'Submitting report' : 'Settling escalation deposits'
	}
	const getSuccessTitle = (actionName: ReportingActionResult['action']) => {
		if (actionName === 'approveReportingRep') return 'Reporting REP approved'
		return actionName === 'reportOutcome' ? 'Report submitted' : 'Escalation deposits settled'
	}
	const getFailureTitle = (actionName: ReportingActionResult['action']) => {
		if (actionName === 'approveReportingRep') return 'REP approval failed'
		return actionName === 'reportOutcome' ? 'Report failed' : 'Settlement failed'
	}

	const requireSelectedOutcome = (selectedOutcome: ReportingFormState['selectedOutcome']) => {
		if (selectedOutcome !== undefined) return selectedOutcome
		throw new Error('Select an outcome side before reporting on a question.')
	}
	const isReportingSelectionCurrent = (selectionKey: string) => currentReportingSelectionKeyRef.current === selectionKey && currentAccountRef.current === accountAddress

	const resolveReportingSecurityPoolAddress = () => parseAddressInput(effectiveReportingPoolAddressInput, 'Security pool address')

	const loadReporting = async () => {
		const selectionKey = currentReportingSelectionKey
		const isCurrentLoad = nextReportingLoad()
		await reportingLoad.run({
			isCurrent: () => isCurrentLoad() && isReportingSelectionCurrent(selectionKey),
			onStart: () => {
				reportingError.value = undefined
			},
			load: async () => {
				const securityPoolAddress = resolveReportingSecurityPoolAddress()
				return await dependencies.loadReportingDetails(securityPoolAddress, accountAddress)
			},
			onSuccess: details => {
				reportingDetails.value = details
			},
			onError: error => {
				reportingDetails.value = undefined
				reportingError.value = getErrorMessage(error, 'Failed to load reporting details')
			},
		})
	}

	useEffect(() => {
		if (previousAccountRef.current === accountAddress) return
		previousAccountRef.current = accountAddress
		const hadReportingContext = reportingDetails.value !== undefined || reportingLoad.isLoading.value
		reportingDetails.value = undefined
		reportingError.value = undefined
		reportingLoad.invalidate()
		if (hadReportingContext) void loadReporting()
	}, [accountAddress, loadReporting, reportingDetails, reportingError, reportingLoad])

	const runReportingAction = async (
		actionName: ReportingActionResult['action'],
		action: (walletAddress: Address, securityPoolAddress: Address, currentForm: ReportingFormState, isCurrentSelection: () => boolean, context: WriteActionContext) => Promise<ReportingActionResult | undefined>,
		errorFallback: string,
		outcomeOverride?: ReportingOutcomeKey,
	) => {
		const currentForm = reportingForm.value
		const actionSelectionKey = currentReportingSelectionKey
		const transactionContext = {
			outcome: outcomeOverride ?? currentForm.selectedOutcome,
			securityPoolAddress: actionSelectionKey === '' ? undefined : actionSelectionKey,
			universeId: reportingDetails.value?.universeId,
		}
		const isCurrentSelection = () => isReportingSelectionCurrent(actionSelectionKey)
		try {
			reportingActiveAction.value = actionName
			reportingFeedback.value = createPendingActionFeedback(actionName, getPendingTitle(actionName))
			await runWriteAction(
				{
					...buildWriteActionConfig(
						{ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, refreshState },
						reportingError,
						'Connect a wallet before reporting on a question',
						createReportingTransactionIntent(actionName, transactionContext),
					),
					onRefreshError: (message, hash) => {
						reportingFeedback.value = createWarningActionFeedback(actionName, getSuccessTitle(actionName), message, hash)
						const result = reportingResult.value
						if (result !== undefined) onTransactionPresented(createReportingWarningPresentation(result, message))
					},
					onWriteCanceled: () => {
						reportingFeedback.value = undefined
					},
					onWriteError: message => {
						reportingFeedback.value = createErrorActionFeedback(actionName, getFailureTitle(actionName), message)
					},
					refreshErrorFallback: 'Reporting transaction succeeded, but refreshing reporting details failed',
					refreshState: async () => {
						await refreshWalletStateOnly(refreshState)
					},
				},
				async (walletAddress, context) => {
					reportingResult.value = undefined
					const securityPoolAddress = resolveReportingSecurityPoolAddress()
					return await action(walletAddress, securityPoolAddress, currentForm, isCurrentSelection, context)
				},
				errorFallback,
				async result => {
					reportingResult.value = result
					reportingFeedback.value = createSuccessActionFeedback(actionName, getSuccessTitle(actionName), result.hash)
					onTransactionPresented(createReportingSuccessPresentation(result))
					if (!isReportingSelectionCurrent(actionSelectionKey)) return
					const details = await dependencies.loadReportingDetails(result.securityPoolAddress, accountAddress)
					if (!isReportingSelectionCurrent(actionSelectionKey)) return
					reportingDetails.value = details
					setReportingForm(current => {
						const selectedWithdrawDepositIndexesByOutcome = pruneSelectedWithdrawDepositIndexesByOutcome(current.selectedWithdrawDepositIndexesByOutcome, details)
						if (sameSelectedWithdrawDepositIndexesByOutcome(current.selectedWithdrawDepositIndexesByOutcome, selectedWithdrawDepositIndexesByOutcome)) return current
						return {
							...current,
							selectedWithdrawDepositIndexesByOutcome,
						}
					})
				},
			)
		} finally {
			reportingActiveAction.value = undefined
		}
	}

	const loadReportingContributionPreflight = async (walletAddress: Address, securityPoolAddress: Address, currentForm: ReportingFormState, isCurrentSelection: () => boolean) => {
		const selectedOutcome = requireSelectedOutcome(currentForm.selectedOutcome)
		const reportAmount = parseRepAmountInput(currentForm.reportAmount, 'Report amount')
		const displayedFunding = reportingDetails.value === undefined ? undefined : getReportingContributionFunding(reportingDetails.value, currentForm.contributionFunding)
		const latestDetails = await dependencies.loadReportingDetails(securityPoolAddress, walletAddress)
		if (!isCurrentSelection()) return undefined
		if (latestDetails.systemState !== 'operational') throw new Error('Reporting actions are unavailable until this pool is operational.')
		const contributionPreview = previewReportingContribution(latestDetails, selectedOutcome, reportAmount)
		if (contributionPreview.actualDepositAmount === undefined) throw new Error(contributionPreview.reason ?? 'Unable to preview the REP that would become dispute-staked for this report.')
		const remainingSelectedOutcomeCapacity = getRemainingSelectedOutcomeContributionCapacity(latestDetails, selectedOutcome)
		if (contributionPreview.actualDepositAmount > remainingSelectedOutcomeCapacity) {
			if (remainingSelectedOutcomeCapacity === 0n) throw new Error('No remaining contribution capacity is available on the selected side.')
			throw new Error(`Only ${formatCurrencyBalanceWithUnit(remainingSelectedOutcomeCapacity, 'REP')} remains before the selected side reaches the threshold.`)
		}
		const contributionFunding = displayedFunding ?? getReportingContributionFunding(latestDetails, currentForm.contributionFunding)
		if (contributionFunding === 'wallet') {
			if (latestDetails.status === 'active' && latestDetails.forkContinuation && !(reportingDetails.value?.status === 'active' && reportingDetails.value.forkContinuation)) throw new Error('Reporting now needs a vault deposit first. Refresh reporting details before submitting.')
			const walletDepositAmount = getReportingWalletDepositAmount(latestDetails, contributionPreview.actualDepositAmount)
			if (walletDepositAmount === undefined) throw new Error('Loading vault funding requirements.')
			const walletRepBalanceAttoRep = latestDetails.viewerWalletRepBalanceAttoRep ?? 0n
			if (walletDepositAmount > walletRepBalanceAttoRep) throw new Error(`Insufficient wallet REP. Add ${formatAdditionalCurrencyBalance(walletDepositAmount - walletRepBalanceAttoRep, 'REP')} before reporting.`)
		} else {
			if ((!latestDetails.viewerVaultExists || latestDetails.viewerPoolHeldVaultRepBackingAttoRep === 0n) && !(latestDetails.status === 'active' && latestDetails.forkContinuation)) throw new Error(reportingCopy.noVaultRepSelectWallet)
			if (!latestDetails.viewerVaultExists) throw new Error('This contribution uses pool-held REP backing. Deposit REP into your vault before reporting.')
			const poolHeldVaultRepBackingAttoRep = latestDetails.viewerPoolHeldVaultRepBackingAttoRep ?? 0n
			if (contributionPreview.actualDepositAmount > poolHeldVaultRepBackingAttoRep && !(latestDetails.status === 'active' && latestDetails.forkContinuation)) throw new Error(reportingCopy.insufficientVaultRepSelectWallet(formatCurrencyBalanceWithUnit(poolHeldVaultRepBackingAttoRep, 'REP')))
			if (contributionPreview.actualDepositAmount > poolHeldVaultRepBackingAttoRep) throw new Error(`Insufficient pool-held vault REP backing. Deposit ${formatAdditionalCurrencyBalance(contributionPreview.actualDepositAmount - poolHeldVaultRepBackingAttoRep, 'REP')} into your vault before reporting.`)
		}
		if (!isCurrentSelection()) return undefined
		return { actualDepositAmount: contributionPreview.actualDepositAmount, walletDepositAmount: getReportingWalletDepositAmount(latestDetails, contributionPreview.actualDepositAmount), contributionFunding, latestDetails, reportAmount, selectedOutcome }
	}

	const approveRepForReporting = async () =>
		await runReportingAction(
			'approveReportingRep',
			async (walletAddress, securityPoolAddress, currentForm, isCurrentSelection, context) => {
				const preflight = await loadReportingContributionPreflight(walletAddress, securityPoolAddress, currentForm, isCurrentSelection)
				if (preflight === undefined) return undefined
				if (preflight.walletDepositAmount === undefined) throw new Error('Loading vault funding requirements.')
				if (preflight.contributionFunding !== 'wallet') throw new Error('This escalation contribution uses vault backing and does not require wallet REP approval.')
				if ((preflight.latestDetails.viewerWalletRepAllowanceAttoRep ?? 0n) >= preflight.walletDepositAmount) throw new Error('The escalation game already has enough REP allowance for this contribution.')
				return { ...(await dependencies.approveReportingRep(walletAddress, { onTransactionPrepared, onTransactionSubmitted, reviewSignal: context.reviewSignal }, securityPoolAddress, preflight.selectedOutcome, preflight.walletDepositAmount)), amountAttoRep: preflight.walletDepositAmount }
			},
			'Failed to approve REP for reporting',
		)

	const reportOutcome = async () =>
		await runReportingAction(
			'reportOutcome',
			async (walletAddress, securityPoolAddress, currentForm, isCurrentSelection, context) => {
				const preflight = await loadReportingContributionPreflight(walletAddress, securityPoolAddress, currentForm, isCurrentSelection)
				if (preflight === undefined) return undefined
				if (preflight.contributionFunding === 'wallet' && (preflight.latestDetails.viewerWalletRepAllowanceAttoRep ?? 0n) < (preflight.walletDepositAmount ?? preflight.actualDepositAmount)) {
					throw new Error('Approve REP for this escalation game before reporting.')
				}
				if (preflight.contributionFunding === 'wallet' && preflight.latestDetails.status === 'active' && preflight.latestDetails.forkContinuation) {
					const execute = dependencies.reportOutcomeWithWalletViaVault
					if (execute === undefined || preflight.walletDepositAmount === undefined) throw new Error('Wallet reporting is unavailable. Refresh the pool and retry.')
					let funded = false
					try {
						return {
							...(await execute(walletAddress, { onTransactionPrepared, onTransactionSubmitted, reviewSignal: context.reviewSignal, skipAppReview: true }, securityPoolAddress, preflight.selectedOutcome, preflight.reportAmount, preflight.walletDepositAmount, () => {
								funded = true
							})),
							amountAttoRep: preflight.actualDepositAmount,
						}
					} catch (error) {
						if (funded && isCurrentSelection()) {
							setReportingForm(current => ({ ...current, contributionFunding: 'vault' }))
							await loadReporting()
						}
						throw error
					}
				}
				return {
					...(await dependencies.reportOutcomeInSecurityPool(walletAddress, { onTransactionPrepared, onTransactionSubmitted, reviewSignal: context.reviewSignal, skipAppReview: true }, securityPoolAddress, preflight.selectedOutcome, preflight.reportAmount, preflight.actualDepositAmount, preflight.contributionFunding)),
					amountAttoRep: preflight.actualDepositAmount,
				}
			},
			'Failed to report on outcome',
		)

	const withdrawEscalation = async (outcome: ReportingOutcomeKey, depositIndexesOverride?: bigint[]) =>
		await runReportingAction(
			'withdrawEscalation',
			async (walletAddress, securityPoolAddress, currentForm, isCurrentSelection, context) => {
				const latestDetails = await dependencies.loadReportingDetails(securityPoolAddress, walletAddress)
				if (!isCurrentSelection()) return undefined
				if (latestDetails.status !== 'active') {
					throw new Error('Withdrawals are unavailable until the first report or contribution deploys the escalation game.')
				}
				if (latestDetails.systemState !== 'operational') throw new Error('Reporting actions are unavailable until this pool is operational.')
				const selectedSide = latestDetails.sides.find(side => side.key === outcome)
				if (selectedSide === undefined) {
					throw new Error('Unable to load deposits for the requested outcome side.')
				}
				const availableDepositIndexes = selectedSide?.userDeposits.map(deposit => deposit.depositIndex) ?? []

				if (latestDetails.settlementState === 'migration-required') throw new Error('Settle winning carried proofs in the child continuation after it finalizes; parent deposits do not need migration.')
				if (latestDetails.settlementState === 'migration-expired') throw new Error('Settle winning carried proofs in the finalized child; the optional unresolved parent escalation-deposit accounting cleanup window has closed.')
				if (!latestDetails.parentWithdrawalEnabled) throw new Error('Escalation deposits cannot be settled until the question is finalized.')

				const requestedDepositIndexes = depositIndexesOverride ?? currentForm.selectedWithdrawDepositIndexesByOutcome[outcome]
				const missingSelectedDepositIndex = requestedDepositIndexes.find(index => !availableDepositIndexes.includes(index))
				if (missingSelectedDepositIndex !== undefined) {
					throw new Error(`Selected deposit #${missingSelectedDepositIndex.toString()} is no longer available to settle on ${selectedSide.label}.`)
				}

				const depositIndexes = requestedDepositIndexes
				if (depositIndexes.length === 0) {
					throw new Error(reportingCopy.settlementSelectionRequired)
				}
				if (!isCurrentSelection()) return undefined

				const claimAmount = selectedSide.userDeposits.filter(deposit => depositIndexes.includes(deposit.depositIndex)).reduce((sum, deposit) => sum + (getEscalationDepositClaimAmount(latestDetails, outcome, deposit) ?? 0n), 0n)
				return { ...(await dependencies.withdrawEscalationFromSecurityPool(walletAddress, { onTransactionPrepared, onTransactionSubmitted, reviewSignal: context.reviewSignal }, securityPoolAddress, outcome, depositIndexes, claimAmount)), amountAttoRep: claimAmount }
			},
			'Failed to settle escalation deposits',
			outcome,
		)

	return {
		onApproveReportingRep: approveRepForReporting,
		loadingReportingDetails: reportingLoad.isLoading.value,
		loadReporting,
		onReportOutcome: reportOutcome,
		reportingActiveAction: reportingActiveAction.value,
		reportingDetails: reportingDetails.value,
		reportingError: reportingError.value,
		reportingFeedback: reportingFeedback.value,
		reportingForm: reportingForm.value,
		reportingResult: reportingResult.value,
		setReportingForm,
		withdrawEscalation,
	}
}
