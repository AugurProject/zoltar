import { isPlainRecord } from '@zoltar/core-shared/validation/guards'
import { record as validateRecord } from '@zoltar/bot-shared/infrastructure/json-validation'

export function normalizeJournalPosition(value: unknown): Record<string, unknown> {
	const position = validateRecord(value, 'Position journal value', 'Position journal record must be an object')
	const gasExpenditures = position['gasExpenditures']
	if (!Array.isArray(gasExpenditures)) return position
	// Preserve legacy timestamps in any supported journal envelope. Ambiguous entries go to the validator unchanged.
	return {
		...position,
		gasExpenditures: gasExpenditures.map((expenditure: unknown) => {
			if (!isPlainRecord(expenditure) || 'includedAt' in expenditure || !('minedAt' in expenditure)) return expenditure
			const { minedAt, ...fields } = expenditure
			return { ...fields, includedAt: minedAt }
		}),
	}
}
