import type { MarketFormState, SecurityPoolFormState } from '../../../types/app.js'
import { parseDecimalInput } from '@zoltar/ui-core-shared/lib/decimal.js'
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/lib/integerInput.js'
import { createQuestionParameters } from '@zoltar/ui-zoltar/features/questions/lib/questionCreation.js'
import { parseStatoblastSecurityMultiplierBpsInput } from './marketForm.js'

export { validateMarketForm } from '@zoltar/ui-zoltar/features/questions/lib/questionCreation.js'

export function createMarketParameters(form: MarketFormState) {
	return createQuestionParameters(form)
}

function parseQuestionIdInput(value: string) {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error('Question ID is required')
	const parsed = tryParseBigIntInput(trimmed)
	if (parsed === undefined) throw new Error('Question ID must be a valid decimal or hex bigint')
	return parsed
}

export function createSecurityPoolParameters(form: SecurityPoolFormState) {
	const questionId = parseQuestionIdInput(form.marketId)
	const statoblastSecurityMultiplierBps = parseStatoblastSecurityMultiplierBpsInput(form.statoblastSecurityMultiplierBps)
	if (statoblastSecurityMultiplierBps <= 10_001n) throw new Error('Statoblast security multiplier must be at least 1.0002')
	const initialReportPriorityFeeAttoEthPerGas = parseDecimalInput(form.initialReportPriorityFeeGwei, 'Initial report priority fee', 9)
	if (initialReportPriorityFeeAttoEthPerGas <= 0n) throw new Error('Initial report priority fee must be greater than 0')
	return {
		initialReportPriorityFeeAttoEthPerGas,
		questionId,
		statoblastSecurityMultiplierBps,
	}
}
