import { ETH_GAS_RESERVE_ATTO_ETH } from '@zoltar/ui-core-shared/lib/ethGasReserve.js'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
export { approvalFailed as failed, approvalRequired, formatInsufficientBalance as insufficient, fundingLoading as loading } from '@zoltar/ui-statoblast-shared/copy/collateral.js'
export const funding = 'Collateral approval'
export const nativeBalanceUnavailable = 'Wallet ETH balance unavailable.'
export const nativeBalanceLoading = 'Loading wallet ETH balance…'
export const gasRequired = `Leave at least ${formatTrimmedUnits(ETH_GAS_RESERVE_ATTO_ETH)} ETH in the wallet for transaction gas.`
