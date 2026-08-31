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
		reportAmount: '0',
		securityPoolAddress: '',
		selectedOutcome: undefined,
		selectedWithdrawDepositIndexesByOutcome: getDefaultReportingWithdrawDepositIndexesByOutcome(),
	}
}

export function getDefaultZoltarMigrationFormState(): ZoltarMigrationFormState {
	return {
		amount: '0.0',
		outcomeIndexes: '',
	}
}
