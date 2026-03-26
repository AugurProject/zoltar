import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { loadReportingDetails, reportOutcomeInSecurityPool, withdrawEscalationFromSecurityPool } from '../contracts.js'
import { createReadClient, createWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { parseAddressInput, parseBigIntListInput } from '../lib/inputs.js'
import { getDefaultReportingFormState, parseBigIntInput } from '../lib/marketForm.js'
import { setSignalValue, updateSignalValue } from '../lib/signals.js'
import type { ReportingFormState } from '../types/app.js'
import type { ReportingActionResult, ReportingDetails } from '../types/contracts.js'

type UseReportingOperationsParameters = {
	accountAddress: Address | undefined
	onTransaction: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useReportingOperations({ accountAddress, onTransaction, refreshState }: UseReportingOperationsParameters) {
	const loadingReportingDetails = useSignal(false)
	const reportingDetails = useSignal<ReportingDetails | undefined>(undefined)
	const reportingError = useSignal<string | undefined>(undefined)
	const reportingForm = useSignal<ReportingFormState>(getDefaultReportingFormState())
	const reportingResult = useSignal<ReportingActionResult | undefined>(undefined)

	const loadReporting = async () => {
		setSignalValue(loadingReportingDetails, true)
		setSignalValue(reportingError, undefined)
		try {
			const securityPoolAddress = parseAddressInput(reportingForm.value.securityPoolAddress, 'Security pool address')
			const details = await loadReportingDetails(createReadClient(), securityPoolAddress, accountAddress)
			setSignalValue(reportingDetails, details)
		} catch (error) {
			setSignalValue(reportingDetails, undefined)
			setSignalValue(reportingError, getErrorMessage(error, 'Failed to load reporting details'))
		} finally {
			setSignalValue(loadingReportingDetails, false)
		}
	}

	const runReportingAction = async (action: (walletAddress: Address, securityPoolAddress: Address) => Promise<ReportingActionResult>, errorFallback: string) => {
		const ethereum = getRequiredInjectedEthereum()
		if (ethereum === undefined) {
			setSignalValue(reportingError, 'No injected wallet found')
			return
		}
		if (accountAddress === undefined) {
			setSignalValue(reportingError, 'Connect a wallet before reporting on a market')
			return
		}

		try {
			setSignalValue(reportingError, undefined)
			setSignalValue(reportingResult, undefined)
			const securityPoolAddress = parseAddressInput(reportingForm.value.securityPoolAddress, 'Security pool address')
			const result = await action(accountAddress, securityPoolAddress)
			setSignalValue(reportingResult, result)
			onTransaction(result.hash)
			await refreshState()
			const details = await loadReportingDetails(createReadClient(), securityPoolAddress, accountAddress)
			setSignalValue(reportingDetails, details)
		} catch (error) {
			setSignalValue(reportingError, getErrorMessage(error, errorFallback))
		}
	}

	const reportOutcome = async () => await runReportingAction(async (walletAddress, securityPoolAddress) => await reportOutcomeInSecurityPool(createWriteClient(getRequiredInjectedEthereum(), walletAddress), securityPoolAddress, reportingForm.value.selectedOutcome, parseBigIntInput(reportingForm.value.reportAmount, 'Report amount')), 'Failed to report on outcome')

	const withdrawEscalation = async () =>
		await runReportingAction(async (walletAddress, securityPoolAddress) => {
			const selectedSide = reportingDetails.value?.sides.find(side => side.key === reportingForm.value.selectedOutcome)
			const depositIndexes = reportingForm.value.withdrawDepositIndexes.trim() === '' ? (selectedSide?.userDeposits.map(deposit => deposit.depositIndex) ?? []) : parseBigIntListInput(reportingForm.value.withdrawDepositIndexes, 'Deposit indexes')

			if (depositIndexes.length === 0) {
				throw new Error('No deposits available to withdraw for the selected side')
			}

			return await withdrawEscalationFromSecurityPool(createWriteClient(getRequiredInjectedEthereum(), walletAddress), securityPoolAddress, reportingForm.value.selectedOutcome, depositIndexes)
		}, 'Failed to withdraw escalation deposits')

	return {
		loadingReportingDetails: loadingReportingDetails.value,
		loadReporting,
		onReportOutcome: reportOutcome,
		reportingDetails: reportingDetails.value,
		reportingError: reportingError.value,
		reportingForm: reportingForm.value,
		reportingResult: reportingResult.value,
		setReportingForm: (updater: (current: ReportingFormState) => ReportingFormState) => {
			updateSignalValue(reportingForm, updater)
		},
		withdrawEscalation,
	}
}
