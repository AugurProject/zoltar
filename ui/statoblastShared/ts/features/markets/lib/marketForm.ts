import type { TradingFormState } from '../../../types/app.js'

export function getDefaultTradingFormState(): TradingFormState {
	return {
		completeSetAmount: '',
		redeemAmount: '',
		questionLedgerAddress: '',
		selectedShareOutcome: 'yes',
		targetOutcomeIndexes: '',
	}
}
