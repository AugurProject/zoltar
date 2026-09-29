import type { MarketFormState, SecurityPoolFormState } from '../../../types/app.js'
import { parseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { normalizeQuestionId } from '@zoltar/ui-core-shared/lib/questionId.js'
import { createQuestionParameters } from '@zoltar/ui-zoltar-shared/features/questions/lib/questionCreation.js'
import { MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { parseStatoblastSecurityMultiplierBpsInput } from './marketForm.js'

export function createMarketParameters(form: MarketFormState) {
	return createQuestionParameters(form)
}

function parseQuestionIdInput(value: string) {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error('Question ID is required')
	const parsed = normalizeQuestionId(trimmed)
	if (parsed === undefined) throw new Error('Enter a valid hexadecimal question ID.')
	return BigInt(parsed)
}

export function createSecurityPoolParameters(form: SecurityPoolFormState) {
	const questionId = parseQuestionIdInput(form.marketId)
	const statoblastSecurityMultiplierBps = parseStatoblastSecurityMultiplierBpsInput(form.statoblastSecurityMultiplierBps)
	if (statoblastSecurityMultiplierBps <= 10_001n) throw new Error('Statoblast security multiplier must be at least 1.0002')
	const initialReportPriorityFeeAttoEthPerGas = parseDecimalInput(form.initialReportPriorityFeeEth, 'Initial report priority fee', 18)
	if (initialReportPriorityFeeAttoEthPerGas <= 0n) throw new Error('Initial report priority fee must be greater than 0')
	if (initialReportPriorityFeeAttoEthPerGas > MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS) throw new Error('Initial-report priority fee is too large for Open Oracle report limits.')
	return {
		initialReportPriorityFeeAttoEthPerGas,
		questionId,
		statoblastSecurityMultiplierBps,
	}
}
