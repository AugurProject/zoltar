import { useState } from 'preact/hooks'
import type { Address, Hash } from 'viem'
import { loadReportingDetails, reportOutcomeInSecurityPool, withdrawEscalationFromSecurityPool } from '../contracts.js'
import { createReadClient, createWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput, parseBigIntListInput } from '../lib/inputs.js'
import { getDefaultReportingFormState, parseBigIntInput } from '../lib/marketForm.js'
import type { ReportingFormState } from '../types/app.js'
import type { ReportingActionResult, ReportingDetails } from '../types/contracts.js'

type UseReportingOperationsParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useReportingOperations({ accountAddress, onTransaction, refreshState }: UseReportingOperationsParameters) {
	const [loadingReportingDetails, setLoadingReportingDetails] = useState(false)
	const [reportingDetails, setReportingDetails] = useState<ReportingDetails | undefined>(undefined)
	const [reportingError, setReportingError] = useState<string | undefined>(undefined)
	const [reportingForm, setReportingForm] = useState<ReportingFormState>(() => getDefaultReportingFormState())
	const [reportingResult, setReportingResult] = useState<ReportingActionResult | undefined>(undefined)

	const loadReporting = async () => {
		setLoadingReportingDetails(true)
		setReportingError(undefined)
		try {
			const securityPoolAddress = parseAddressInput(reportingForm.securityPoolAddress, 'Security pool address')
			const details = await loadReportingDetails(createReadClient(), securityPoolAddress, accountAddress)
			setReportingDetails(details)
		} catch (error) {
			setReportingDetails(undefined)
			setReportingError(getErrorMessage(error, 'Failed to load reporting details'))
		} finally {
			setLoadingReportingDetails(false)
		}
	}

	const runReportingAction = async (action: (walletAddress: Address, securityPoolAddress: Address) => Promise<ReportingActionResult>, errorFallback: string) => {
		const ethereum = getRequiredInjectedEthereum()
		if (ethereum === undefined) {
			setReportingError('No injected wallet found')
			return
		}
		if (accountAddress === undefined) {
			setReportingError('Connect a wallet before reporting on a market')
			return
		}

		try {
			setReportingError(undefined)
			setReportingResult(undefined)
			const securityPoolAddress = parseAddressInput(reportingForm.securityPoolAddress, 'Security pool address')
			const result = await action(accountAddress, securityPoolAddress)
			setReportingResult(result)
			onTransaction(result.hash)
			await refreshState()
			const details = await loadReportingDetails(createReadClient(), securityPoolAddress, accountAddress)
			setReportingDetails(details)
		} catch (error) {
			setReportingError(getErrorMessage(error, errorFallback))
		}
	}

	const reportOutcome = async () => await runReportingAction(async (walletAddress, securityPoolAddress) => await reportOutcomeInSecurityPool(createWriteClient(getRequiredInjectedEthereum(), walletAddress), securityPoolAddress, reportingForm.selectedOutcome, parseBigIntInput(reportingForm.reportAmount, 'Report amount')), 'Failed to report on outcome')

	const withdrawEscalation = async () =>
		await runReportingAction(async (walletAddress, securityPoolAddress) => {
			const selectedSide = reportingDetails?.sides.find(side => side.key === reportingForm.selectedOutcome)
			const depositIndexes = reportingForm.withdrawDepositIndexes.trim() === '' ? (selectedSide?.userDeposits.map(deposit => deposit.depositIndex) ?? []) : parseBigIntListInput(reportingForm.withdrawDepositIndexes, 'Deposit indexes')

			if (depositIndexes.length === 0) {
				throw new Error('No deposits available to withdraw for the selected side')
			}

			return await withdrawEscalationFromSecurityPool(createWriteClient(getRequiredInjectedEthereum(), walletAddress), securityPoolAddress, reportingForm.selectedOutcome, depositIndexes)
		}, 'Failed to withdraw escalation deposits')

	return {
		loadingReportingDetails,
		loadReporting,
		onReportOutcome: reportOutcome,
		reportingDetails,
		reportingError,
		reportingForm,
		reportingResult,
		setReportingForm,
		withdrawEscalation,
	}
}
