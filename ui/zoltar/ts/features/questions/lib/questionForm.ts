import type { MarketFormState } from '../../../types/app.js'

export function getDefaultMarketFormState(): MarketFormState {
	return {
		answerUnit: '',
		categoricalOutcomes: ['Yes', 'No'],
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
