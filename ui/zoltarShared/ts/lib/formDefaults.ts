import type { ReportingFormState, ReportingWithdrawDepositIndexesByOutcome, ZoltarMigrationFormState } from '../types/app.js'

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

export function getDefaultZoltarMigrationFormState(): ZoltarMigrationFormState {
	return {
		amount: '',
		outcomeIndexes: [],
	}
}
