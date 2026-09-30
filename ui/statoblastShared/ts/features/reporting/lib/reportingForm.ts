import { sameCaseInsensitiveText } from '@zoltar/ui-core-shared/lib/caseInsensitive.js'
import type { ReportingFormState, ReportingWithdrawDepositIndexesByOutcome } from '../../../types/app.js'

export function getDefaultReportingWithdrawDepositIndexesByOutcome(): ReportingWithdrawDepositIndexesByOutcome {
	return {
		invalid: [],
		yes: [],
		no: [],
	}
}

export function getDefaultReportingFormState(): ReportingFormState {
	return {
		reportAmount: '',
		securityPoolAddress: '',
		selectedOutcome: undefined,
		selectedWithdrawDepositIndexesByOutcome: getDefaultReportingWithdrawDepositIndexesByOutcome(),
	}
}

export function applyReportingFormUpdate(current: ReportingFormState, update: Partial<ReportingFormState>): ReportingFormState {
	const securityPoolAddressChanged = update.securityPoolAddress !== undefined && !sameCaseInsensitiveText(current.securityPoolAddress, update.securityPoolAddress)
	const nextForm = {
		...current,
		...update,
		...(securityPoolAddressChanged
			? {
					selectedOutcome: undefined,
					selectedWithdrawDepositIndexesByOutcome: getDefaultReportingWithdrawDepositIndexesByOutcome(),
				}
			: {}),
	}

	const hasChanged = (Object.keys(update) as Array<keyof ReportingFormState>).some(key => {
		if (key === 'securityPoolAddress' && update.securityPoolAddress !== undefined) return securityPoolAddressChanged || !sameCaseInsensitiveText(current.securityPoolAddress, nextForm.securityPoolAddress)
		return current[key] !== nextForm[key]
	})

	if (!hasChanged && current.selectedOutcome === nextForm.selectedOutcome) return current
	return nextForm
}
