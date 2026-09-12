import { normalizeNumericInput } from '@zoltar/ui-core-shared/lib/numericInput.js'
import { bigintToSafeNumber } from '@zoltar/core-shared/evm/ethereum'
import { abbreviateAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'

function requireNonNegativeSafeInteger(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative safe integer`)
}

export function formatUnits(value: bigint, decimals = 18, maximumFractionDigits = 4) {
	requireNonNegativeSafeInteger(decimals, 'Decimals')
	requireNonNegativeSafeInteger(maximumFractionDigits, 'Maximum fraction digits')
	return formatTrimmedUnits(value, decimals, maximumFractionDigits)
}

/** Rounds half-up to the displayed precision instead of truncating, so exact amounts do not render one digit short. */
export function formatRoundedUnits(value: bigint, decimals = 18, maximumFractionDigits = 4) {
	requireNonNegativeSafeInteger(decimals, 'Decimals')
	requireNonNegativeSafeInteger(maximumFractionDigits, 'Maximum fraction digits')
	if (maximumFractionDigits >= decimals) return formatTrimmedUnits(value, decimals, maximumFractionDigits)
	const step = 10n ** BigInt(decimals - maximumFractionDigits)
	const magnitude = value < 0n ? -value : value
	const rounded = ((magnitude + step / 2n) / step) * step
	return formatTrimmedUnits(value < 0n ? -rounded : rounded, decimals, maximumFractionDigits)
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
	value = normalizeNumericInput(value)
	requireNonNegativeSafeInteger(decimals, 'Decimals')
	if (!/^\d*(?:\.\d*)?$/.test(value) || value.length === 0 || value === '.') throw new Error('Enter a valid nonnegative amount')
	const fraction = value.split('.')[1] ?? ''
	if (fraction.length > decimals) throw new Error(`Use no more than ${decimals} decimal places`)
	const parsed = tryParseDecimalInput(value, decimals)
	if (parsed === undefined || parsed < 0n) throw new Error('Enter a valid nonnegative amount')
	return parsed
}

export function parseUnitsOrUndefined(value: string, decimals = 18) {
	value = normalizeNumericInput(value)
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
