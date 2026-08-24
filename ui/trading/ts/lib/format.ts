import { bigintToSafeNumber } from '@zoltar/shared/ethereum'
import { abbreviateAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { tryParseDecimalInput } from '@zoltar/ui-core-shared/lib/decimal.js'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'

function requireNonNegativeSafeInteger(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative safe integer`)
}

export function formatUnits(value: bigint, decimals = 18, maximumFractionDigits = 4) {
	requireNonNegativeSafeInteger(decimals, 'Decimals')
	requireNonNegativeSafeInteger(maximumFractionDigits, 'Maximum fraction digits')
	return formatTrimmedUnits(value, decimals, maximumFractionDigits)
}

export function formatShareAmount(value: bigint, maximumFractionDigits = 4) {
	return `${formatUnits(value, 18, maximumFractionDigits)} shares`
}

export function formatOutcomeAmount(value: bigint, outcome: 'YES' | 'NO' | 'INVALID', maximumFractionDigits = 4) {
	return `${formatUnits(value, 18, maximumFractionDigits)} ${outcome}`
}

export function formatEthPerShare(collateralWei: bigint, atomicShareSupply: bigint, maximumSignificantDigits = 4) {
	if (!Number.isSafeInteger(maximumSignificantDigits) || maximumSignificantDigits < 1) throw new Error('Maximum significant digits must be a positive safe integer')
	if (collateralWei < 0n || atomicShareSupply <= 0n) throw new Error('Collateral rate requires nonnegative collateral and positive share supply')
	const precision = 36
	const scaled = (collateralWei * 10n ** BigInt(precision)) / atomicShareSupply
	const digits = scaled.toString().padStart(precision + 1, '0')
	const whole = digits.slice(0, -precision)
	const fraction = digits.slice(-precision)
	const firstNonzero = fraction.search(/[1-9]/)
	if (firstNonzero === -1) return `${whole} ETH / share`
	const visibleEnd = Math.min(fraction.length, firstNonzero + maximumSignificantDigits)
	return `${whole}.${fraction.slice(0, visibleEnd).replace(/0+$/, '')} ETH / share`
}

export function formatBpsMultiplier(value: bigint) {
	const whole = value / 10_000n
	const fraction = (value % 10_000n).toString().padStart(4, '0').replace(/0+$/, '')
	return `${whole}${fraction.length > 0 ? `.${fraction}` : ''}×`
}

export function formatCapacityOwnership(totalAttoRep: bigint, feeEligibleAttoRep: bigint) {
	return `${formatUnits(totalAttoRep)} / ${formatUnits(feeEligibleAttoRep)} REP`
}

export function formatMintingCapacity(mintedAttoEth: bigint, maximumAttoEth: bigint) {
	return `${formatUnits(mintedAttoEth)} / ${formatUnits(maximumAttoEth)} ETH`
}

export { bigintToSafeNumber }

export function parseUnits(value: string, decimals = 18) {
	requireNonNegativeSafeInteger(decimals, 'Decimals')
	if (!/^\d*(?:\.\d*)?$/.test(value) || value.length === 0 || value === '.') throw new Error('Enter a valid nonnegative amount')
	const fraction = value.split('.')[1] ?? ''
	if (fraction.length > decimals) throw new Error(`Use no more than ${decimals} decimal places`)
	const parsed = tryParseDecimalInput(value, decimals)
	if (parsed === undefined || parsed < 0n) throw new Error('Enter a valid nonnegative amount')
	return parsed
}

export function parseUnitsOrUndefined(value: string, decimals = 18) {
	if (!Number.isSafeInteger(decimals) || decimals < 0) return undefined
	if (!/^\d*(?:\.\d*)?$/.test(value) || value.length === 0 || value === '.') return undefined
	const fraction = value.split('.')[1] ?? ''
	if (fraction.length > decimals) return undefined
	const parsed = tryParseDecimalInput(value, decimals)
	return parsed === undefined || parsed < 0n ? undefined : parsed
}

export function shortAddress(address: string) {
	return abbreviateAddress(address, 6, 4)
}
