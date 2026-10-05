import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import type { MarketFormState } from '../../../types/app.js'

export function getDefaultMarketFormState(): MarketFormState {
	return {
		answerUnit: '',
		categoricalOutcomes: [commonCopy.yes, commonCopy.no],
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
