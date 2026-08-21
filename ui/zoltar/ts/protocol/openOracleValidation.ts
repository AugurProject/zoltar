import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { zeroAddress, type Address } from '@zoltar/shared/ethereum'

export const OPEN_ORACLE_PERCENTAGE_PRECISION = 10n ** 7n
export const OPEN_ORACLE_MULTIPLIER_PRECISION = 100n
const OPEN_ORACLE_UINT16_MAX = (1n << 16n) - 1n
const OPEN_ORACLE_UINT24_MAX = (1n << 24n) - 1n
const OPEN_ORACLE_UINT48_MAX = (1n << 48n) - 1n
const OPEN_ORACLE_UINT96_MAX = (1n << 96n) - 1n
const OPEN_ORACLE_UINT128_MAX = (1n << 128n) - 1n

export type OpenOracleCreateValidationParameters = {
	disputeDelay: bigint
	escalationHalt: bigint
	exactToken1Report: bigint
	initialToken2Amount: bigint
	ethValueAttoEth: bigint
	feePercentage: bigint
	multiplier: bigint
	protocolFee: bigint
	settlementTime: bigint
	settlerRewardAttoEth: bigint
	token1Address: Address
	token2Address: Address
}

export type OpenOracleCreateParameterValidation = {
	field: keyof OpenOracleCreateValidationParameters
	message: string
}

export function getOpenOracleCreateParameterValidation(
	{ disputeDelay, escalationHalt, exactToken1Report, initialToken2Amount, ethValueAttoEth, feePercentage, multiplier, protocolFee, settlementTime, settlerRewardAttoEth, token1Address, token2Address }: OpenOracleCreateValidationParameters,
	{ skipToken1MagnitudeValidation = false }: { skipToken1MagnitudeValidation?: boolean } = {},
): OpenOracleCreateParameterValidation | undefined {
	if (sameAddress(token1Address, token2Address)) return { field: 'token2Address', message: 'Base and quote tokens must use different addresses.' }
	if (sameAddress(token1Address, zeroAddress)) return { field: 'token1Address', message: 'Direct Open Oracle reports currently require two ERC-20 token addresses.' }
	if (sameAddress(token2Address, zeroAddress)) return { field: 'token2Address', message: 'Direct Open Oracle reports currently require two ERC-20 token addresses.' }
	if (exactToken1Report <= 0n) return { field: 'exactToken1Report', message: 'Base token amount must be greater than zero.' }
	if (!skipToken1MagnitudeValidation && exactToken1Report > OPEN_ORACLE_UINT128_MAX) return { field: 'exactToken1Report', message: 'Base token amount exceeds the contract maximum.' }
	if (initialToken2Amount <= 0n) return { field: 'initialToken2Amount', message: 'Quote token amount must be greater than zero.' }
	if (initialToken2Amount > OPEN_ORACLE_UINT128_MAX) return { field: 'initialToken2Amount', message: 'Quote token amount exceeds the contract maximum.' }
	if (escalationHalt < 0n) return { field: 'escalationHalt', message: 'Escalation halt must be non-negative.' }
	if (!skipToken1MagnitudeValidation && escalationHalt > OPEN_ORACLE_UINT128_MAX) return { field: 'escalationHalt', message: 'Escalation halt exceeds the contract maximum.' }
	if (ethValueAttoEth < 0n) return { field: 'ethValueAttoEth', message: 'ETH value to send must be non-negative.' }
	if (ethValueAttoEth > OPEN_ORACLE_UINT96_MAX) return { field: 'ethValueAttoEth', message: 'ETH value to send exceeds the contract maximum.' }
	if (settlerRewardAttoEth < 0n) return { field: 'settlerRewardAttoEth', message: 'Settler reward must be non-negative.' }
	if (settlerRewardAttoEth > OPEN_ORACLE_UINT96_MAX) return { field: 'settlerRewardAttoEth', message: 'Settler reward exceeds the contract maximum.' }
	if (ethValueAttoEth !== settlerRewardAttoEth) return { field: 'ethValueAttoEth', message: 'ETH value to send must equal the settler reward for ERC-20 token pairs.' }
	if (settlementTime < 0n) return { field: 'settlementTime', message: 'Enter a valid settlement time.' }
	if (settlementTime > OPEN_ORACLE_UINT48_MAX) return { field: 'settlementTime', message: 'Settlement time exceeds the contract maximum.' }
	if (disputeDelay < 0n) return { field: 'disputeDelay', message: 'Enter a valid dispute delay.' }
	if (disputeDelay > OPEN_ORACLE_UINT24_MAX) return { field: 'disputeDelay', message: 'Dispute delay exceeds the contract maximum.' }
	if (settlementTime <= disputeDelay) return { field: 'settlementTime', message: 'Settlement time must be greater than dispute delay.' }
	if (multiplier < OPEN_ORACLE_MULTIPLIER_PRECISION) return { field: 'multiplier', message: 'Multiplier must be at least 1.00x.' }
	if (multiplier > OPEN_ORACLE_UINT16_MAX) return { field: 'multiplier', message: 'Multiplier exceeds the contract maximum.' }
	if (feePercentage < 0n) return { field: 'feePercentage', message: 'Fee percentage must be non-negative.' }
	if (feePercentage > OPEN_ORACLE_UINT24_MAX) return { field: 'feePercentage', message: 'Fee percentage exceeds the contract maximum.' }
	if (protocolFee < 0n) return { field: 'protocolFee', message: 'Protocol fee must be non-negative.' }
	if (protocolFee > OPEN_ORACLE_UINT24_MAX) return { field: 'protocolFee', message: 'Protocol fee exceeds the contract maximum.' }
	if (feePercentage + protocolFee > OPEN_ORACLE_PERCENTAGE_PRECISION) return { field: 'protocolFee', message: 'Fee percentage plus protocol fee must not exceed 100%.' }
	return undefined
}

export function getOpenOracleCreateParameterValidationMessage(parameters: OpenOracleCreateValidationParameters, options: { skipToken1MagnitudeValidation?: boolean } = {}) {
	return getOpenOracleCreateParameterValidation(parameters, options)?.message
}
