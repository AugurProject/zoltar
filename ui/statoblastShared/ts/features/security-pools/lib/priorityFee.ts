import { tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { formatCurrencyBalanceWithUnit, formatValueWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'

// Gas prices read in nanoETH (1 nanoETH = 10^9 attoETH), matching wallets and the documentation.
export const NANO_ETH_DECIMALS = 9

/** The initial report priority fee is a per-gas price, so it reads in nanoETH per gas wherever a pool shows it. */
export function formatInitialReportPriorityFee(attoEthPerGas: bigint) {
	return formatCurrencyBalanceWithUnit(attoEthPerGas, securityPoolCopy.initialReportPriorityFeeUnit, NANO_ETH_DECIMALS)
}

/** Parses the nanoETH-per-gas creation input into attoETH per gas. */
export function tryParseInitialReportPriorityFeeInput(input: string) {
	return tryParseDecimalInput(input.trim(), NANO_ETH_DECIMALS)
}

/** Formats the nanoETH-per-gas creation input like the created pool's fee; an unparsable input keeps its typed value. */
export function formatInitialReportPriorityFeeInput(input: string) {
	const attoEthPerGas = tryParseInitialReportPriorityFeeInput(input)
	return attoEthPerGas === undefined ? formatValueWithUnit(input.trim(), securityPoolCopy.initialReportPriorityFeeUnit) : formatInitialReportPriorityFee(attoEthPerGas)
}
