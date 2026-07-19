import { sameAddress } from '../lib/address.js'
import { zeroAddress, type Address } from '@zoltar/shared/ethereum'

export const OPEN_ORACLE_PERCENTAGE_PRECISION = 10n ** 7n
export const OPEN_ORACLE_MULTIPLIER_PRECISION = 100n
const OPEN_ORACLE_UINT16_MAX = (1n << 16n) - 1n
const OPEN_ORACLE_UINT24_MAX = (1n << 24n) - 1n
const OPEN_ORACLE_UINT48_MAX = (1n << 48n) - 1n
const OPEN_ORACLE_UINT96_MAX = (1n << 96n) - 1n
const OPEN_ORACLE_UINT128_MAX = (1n << 128n) - 1n

type OpenOracleCreateValidationParameters = {
	disputeDelay: bigint
	escalationHalt: bigint
	exactToken1Report: bigint
	initialToken2Amount: bigint
	ethValue: bigint
	feePercentage: bigint
	multiplier: bigint
	protocolFee: bigint
	settlementTime: bigint
	settlerReward: bigint
	token1Address: Address
	token2Address: Address
}

export function getOpenOracleCreateParameterValidationMessage(
	{ disputeDelay, escalationHalt, exactToken1Report, initialToken2Amount, ethValue, feePercentage, multiplier, protocolFee, settlementTime, settlerReward, token1Address, token2Address }: OpenOracleCreateValidationParameters,
	{ skipToken1MagnitudeValidation = false }: { skipToken1MagnitudeValidation?: boolean } = {},
) {
	if (sameAddress(token1Address, token2Address)) return 'Token1 and token2 must be different addresses.'
	if (sameAddress(token1Address, zeroAddress) || sameAddress(token2Address, zeroAddress)) return 'Direct Open Oracle reports currently require two ERC-20 token addresses.'
	if (exactToken1Report <= 0n) return 'Exact token1 report must be greater than zero.'
	if (!skipToken1MagnitudeValidation && exactToken1Report > OPEN_ORACLE_UINT128_MAX) return 'Exact token1 report exceeds the contract maximum.'
	if (initialToken2Amount <= 0n) return 'Initial token2 amount must be greater than zero.'
	if (initialToken2Amount > OPEN_ORACLE_UINT128_MAX) return 'Initial token2 amount exceeds the contract maximum.'
	if (escalationHalt < 0n) return 'Escalation halt must be non-negative.'
	if (!skipToken1MagnitudeValidation && escalationHalt > OPEN_ORACLE_UINT128_MAX) return 'Escalation halt exceeds the contract maximum.'
	if (ethValue < 0n) return 'ETH value to send must be non-negative.'
	if (ethValue > OPEN_ORACLE_UINT96_MAX) return 'ETH value to send exceeds the contract maximum.'
	if (settlerReward < 0n) return 'Settler reward must be non-negative.'
	if (settlerReward > OPEN_ORACLE_UINT96_MAX) return 'Settler reward exceeds the contract maximum.'
	if (ethValue !== settlerReward) return 'ETH value to send must equal the settler reward for ERC-20 token pairs.'
	if (settlementTime < 0n) return 'Enter a valid settlement time.'
	if (settlementTime > OPEN_ORACLE_UINT48_MAX) return 'Settlement time exceeds the contract maximum.'
	if (disputeDelay < 0n) return 'Enter a valid dispute delay.'
	if (disputeDelay > OPEN_ORACLE_UINT24_MAX) return 'Dispute delay exceeds the contract maximum.'
	if (settlementTime <= disputeDelay) return 'Settlement time must be greater than dispute delay.'
	if (multiplier < OPEN_ORACLE_MULTIPLIER_PRECISION) return 'Multiplier must be at least 1.00x.'
	if (multiplier > OPEN_ORACLE_UINT16_MAX) return 'Multiplier exceeds the contract maximum.'
	if (feePercentage < 0n) return 'Fee percentage must be non-negative.'
	if (feePercentage > OPEN_ORACLE_UINT24_MAX) return 'Fee percentage exceeds the contract maximum.'
	if (protocolFee < 0n) return 'Protocol fee must be non-negative.'
	if (protocolFee > OPEN_ORACLE_UINT24_MAX) return 'Protocol fee exceeds the contract maximum.'
	if (feePercentage + protocolFee > OPEN_ORACLE_PERCENTAGE_PRECISION) return 'Fee percentage plus protocol fee must not exceed 100%.'
	return undefined
}
