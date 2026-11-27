import type { ReportingFormState } from '../../../types/app.js'

export function getDefaultReportingFormState(): ReportingFormState {
	return {
		reportAmount: '',
		questionLedgerAddress: '',
		selectedOutcome: undefined,
	}
}
