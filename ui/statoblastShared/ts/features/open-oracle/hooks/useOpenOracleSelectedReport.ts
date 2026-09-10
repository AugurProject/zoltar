import { useSignal, type Signal } from '@preact/signals'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { MutableRef } from 'preact/hooks'
import { parseReportIdInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { requireDefined } from '@zoltar/ui-core-shared/forms/required.js'
import { useFormState } from '@zoltar/ui-core-shared/hooks/useFormState.js'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import type { OpenOracleReportDetails, OpenOracleWithdrawableBalances } from '@zoltar/ui-core-shared/types/contracts.js'
import type { OpenOracleFormState } from '@zoltar/ui-zoltar-shared/types/app.js'
import { getOpenOracleAddress } from '../../../protocol/deploymentHelpers.js'
import { isOpenOracleReportMissingError } from '../../../protocol/openOracle.js'
import { getDefaultOpenOracleFormState } from '../lib/formDefaults.js'
import type { OpenOracleReportLookupState } from '../../oracleTypes.js'

export type LoadedOracleReportResult = {
	details: OpenOracleReportDetails
	reportId: bigint
}

export function useOpenOracleSelectedReport({
	accountAddress,
	currentSelectedReportIdRef,
	loadOpenOracleReportDetails,
	loadOpenOracleWithdrawableBalances,
	openOracleError,
	resetOpenOracleTokenAccessState,
}: {
	accountAddress: Address | undefined
	currentSelectedReportIdRef: MutableRef<string>
	loadOpenOracleReportDetails: (openOracleAddress: Address, reportId: bigint) => Promise<OpenOracleReportDetails>
	loadOpenOracleWithdrawableBalances: (openOracleAddress: Address, holder: Address, token1: Address, token2: Address) => Promise<OpenOracleWithdrawableBalances>
	openOracleError: Signal<string | undefined>
	resetOpenOracleTokenAccessState: (approvalLoading: boolean) => void
}) {
	const oracleReportLoad = useLoadController()
	const openOracleWithdrawableBalanceLoad = useLoadController()
	const { state: openOracleForm, setState: setOpenOracleFormState } = useFormState<OpenOracleFormState>(getDefaultOpenOracleFormState())
	const openOracleReportDetails = useSignal<OpenOracleReportDetails | undefined>(undefined)
	const openOracleReportLookupState = useSignal<OpenOracleReportLookupState>('unknown')
	const openOracleWithdrawableBalances = useSignal<OpenOracleWithdrawableBalances | undefined>(undefined)
	const openOracleWithdrawableBalancesError = useSignal<string | undefined>(undefined)
	const loadedOpenOracleReportId = useSignal<bigint | undefined>(undefined)
	const nextOpenOracleWithdrawableBalanceLoad = useRequestGuard()
	const nextOracleReportLoad = useRequestGuard()
	const currentSelectedReportIdInput = openOracleForm.value.reportId.trim()
	currentSelectedReportIdRef.current = currentSelectedReportIdInput

	const isSelectedReportCurrent = (reportIdInput: string) => currentSelectedReportIdRef.current === reportIdInput.trim()

	const refreshOpenOracleWithdrawableBalances = async (details: OpenOracleReportDetails | undefined) => {
		const isCurrent = nextOpenOracleWithdrawableBalanceLoad()
		const holder = accountAddress
		if (details === undefined || holder === undefined) {
			openOracleWithdrawableBalances.value = undefined
			openOracleWithdrawableBalancesError.value = undefined
			return
		}
		const currentReportIdInput = details.reportId.toString()
		await openOracleWithdrawableBalanceLoad.run({
			isCurrent: () => isCurrent() && isSelectedReportCurrent(currentReportIdInput),
			onStart: () => {
				openOracleWithdrawableBalancesError.value = undefined
			},
			load: async () => await loadOpenOracleWithdrawableBalances(getOpenOracleAddress(), holder, details.token1, details.token2),
			onSuccess: balances => {
				openOracleWithdrawableBalances.value = balances
			},
			onError: error => {
				openOracleWithdrawableBalancesError.value = getErrorMessage(error, 'Failed to load Open Oracle balances')
			},
		})
	}

	const applyLoadedOracleReport = (details: OpenOracleReportDetails) => {
		openOracleReportDetails.value = details
		loadedOpenOracleReportId.value = details.reportId
		openOracleForm.value = {
			...openOracleForm.value,
			reportId: details.reportId.toString(),
			stateHash: details.stateHash,
		}
	}

	const loadOracleReportById = async (reportId: bigint) => await loadOpenOracleReportDetails(getOpenOracleAddress(), reportId)
	const setOpenOracleForm = (updater: (current: OpenOracleFormState) => OpenOracleFormState) => {
		setOpenOracleFormState(current => {
			const next = updater(current)
			const nextReportId = next.reportId.trim()
			if (nextReportId === current.reportId.trim()) return next

			currentSelectedReportIdRef.current = nextReportId
			openOracleReportLookupState.value = 'unknown'
			openOracleReportDetails.value = undefined
			loadedOpenOracleReportId.value = undefined
			openOracleError.value = undefined
			resetOpenOracleTokenAccessState(false)
			return { ...getDefaultOpenOracleFormState(), reportId: next.reportId }
		})
	}

	const loadOracleReport = async (reportIdInput?: string) => {
		const requestedReportIdInput = reportIdInput?.trim() ?? currentSelectedReportIdInput
		if (reportIdInput !== undefined) setOpenOracleForm(current => ({ ...current, reportId: requestedReportIdInput }))
		const isCurrentLoad = nextOracleReportLoad()
		await oracleReportLoad.run({
			onStart: () => {
				openOracleError.value = undefined
				openOracleReportLookupState.value = 'loading'
			},
			load: async () => {
				const reportIdValue = reportIdInput?.trim() ?? openOracleForm.value.reportId
				const reportId = parseReportIdInput(reportIdValue)
				const details = await loadOracleReportById(reportId)
				if (!isCurrentLoad() || !isSelectedReportCurrent(requestedReportIdInput)) throw new Error('Stale oracle report load')
				return { details, reportId } satisfies LoadedOracleReportResult
			},
			onSuccess: ({ details }: LoadedOracleReportResult) => {
				if (!isCurrentLoad() || !isSelectedReportCurrent(requestedReportIdInput)) return
				applyLoadedOracleReport(details)
				openOracleReportLookupState.value = 'ready'
			},
			onError: (error: unknown) => {
				if (!isCurrentLoad() || !isSelectedReportCurrent(requestedReportIdInput)) return
				openOracleReportDetails.value = undefined
				loadedOpenOracleReportId.value = undefined
				resetOpenOracleTokenAccessState(false)
				const reportMissing = isOpenOracleReportMissingError(error)
				openOracleReportLookupState.value = reportMissing ? 'missing' : 'load-failed'
				openOracleError.value = reportMissing ? undefined : getErrorMessage(error, 'Failed to load oracle report')
			},
		})
	}
	const ensureLoadedSelectedReport = async ({ forceReload = false, reportIdInput, requireCurrentSelection = false }: { forceReload?: boolean; reportIdInput?: string; requireCurrentSelection?: boolean } = {}) => {
		const selectedReportIdInput = reportIdInput?.trim() ?? currentSelectedReportIdInput
		const reportId = parseReportIdInput(selectedReportIdInput)
		if (!forceReload && openOracleReportDetails.value !== undefined && loadedOpenOracleReportId.value === reportId) return { reportId, details: openOracleReportDetails.value }

		const details = await loadOracleReportById(reportId)
		if (requireCurrentSelection && !isSelectedReportCurrent(selectedReportIdInput)) throw new Error('Selected report changed. Review the current report and try again.')
		applyLoadedOracleReport(details)

		return {
			details,
			reportId,
		}
	}

	const assertSelectedReportCurrent = (reportIdInput: string) => {
		if (!isSelectedReportCurrent(reportIdInput)) throw new Error('Selected report changed. Review the current report and try again.')
	}

	const requireLoadedCurrentSelectedReport = () => {
		const reportDetails = requireDefined(openOracleReportDetails.value, 'Select an oracle report first')
		assertSelectedReportCurrent(reportDetails.reportId.toString())
		return reportDetails
	}

	return {
		applyLoadedOracleReport,
		assertSelectedReportCurrent,
		currentSelectedReportIdInput,
		ensureLoadedSelectedReport,
		isSelectedReportCurrent,
		loadOracleReport,
		loadedOpenOracleReportId,
		openOracleForm,
		openOracleReportDetails,
		openOracleReportLookupState,
		openOracleWithdrawableBalanceLoad,
		openOracleWithdrawableBalances,
		openOracleWithdrawableBalancesError,
		refreshOpenOracleWithdrawableBalances,
		requireLoadedCurrentSelectedReport,
		setOpenOracleForm,
	}
}
