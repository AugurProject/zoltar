import { tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { formatCurrencyBalanceWithUnit, formatValueWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'

/** The initial report priority fee is a per-gas price, so it reads in ETH per gas wherever a pool shows it. */
export function formatInitialReportPriorityFee(attoEthPerGas: bigint) {
	return formatCurrencyBalanceWithUnit(attoEthPerGas, securityPoolCopy.initialReportPriorityFeeUnit, 18)
}

/** Formats the ETH-per-gas creation input like the created pool's fee; an unparsable input keeps its typed ETH-per-gas value. */
export function formatInitialReportPriorityFeeInput(input: string) {
	const trimmed = input.trim()
	const attoEthPerGas = tryParseDecimalInput(trimmed, 18)
	return attoEthPerGas === undefined ? formatValueWithUnit(trimmed, securityPoolCopy.initialReportPriorityFeeUnit) : formatInitialReportPriorityFee(attoEthPerGas)
}
