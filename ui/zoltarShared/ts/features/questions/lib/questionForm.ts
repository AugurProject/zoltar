import type { MarketFormState } from '../../../types/app.js'

export function getDefaultMarketFormState(): MarketFormState {
	return {
		answerUnit: '',
		// Categorical outcomes start empty: Yes and No would create the Binary question's ID.
		categoricalOutcomes: ['', ''],
		description: '',
		endTime: '',
		marketType: 'binary',
		scalarIncrement: '1',
		scalarMax: '100',
		scalarMin: '0',
		title: '',
		startTime: '',
	}
}
