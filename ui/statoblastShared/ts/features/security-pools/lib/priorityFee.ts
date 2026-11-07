import { formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'

// Gas prices read in nanoETH (1 nanoETH = 10^9 attoETH), matching wallets and the documentation.
const NANO_ETH_DECIMALS = 9

/** The initial report priority fee is a per-gas price, so it reads in nanoETH per gas wherever a pool shows it. */
export function formatInitialReportPriorityFee(attoEthPerGas: bigint) {
	return formatCurrencyBalanceWithUnit(attoEthPerGas, securityPoolCopy.initialReportPriorityFeeUnit, NANO_ETH_DECIMALS)
}
