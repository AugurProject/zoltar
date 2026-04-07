import { parseUnits } from 'viem'

type ScalarQuestionDetails = {
	answerUnit: string
	displayValueMax: bigint
	displayValueMin: bigint
	numTicks: bigint
}

type ScalarFormInputs = {
	scalarIncrement: string
	scalarMax: string
	scalarMin: string
}

const SCALAR_DECIMALS = 18n
const SCALAR_DECIMAL_BASE = 10n ** SCALAR_DECIMALS
const SCALAR_PART_BIT_LENGTH = 120n
const SCALAR_TOTAL_BITS = 256n

function normalizeDecimalInput(value: string) {
	const trimmed = value.trim()
	if (trimmed === '') return trimmed
	return trimmed.startsWith('.') ? `0${trimmed}` : trimmed.endsWith('.') ? `${trimmed}0` : trimmed
}

function parseScalarDecimalInput(value: string, label: string) {
	const normalized = normalizeDecimalInput(value)
	if (normalized === '') throw new Error(`${label} is required`)
	try {
		return parseUnits(normalized, Number(SCALAR_DECIMALS))
	} catch {
		throw new Error(`${label} must be a decimal number`)
	}
}

function combineUint256FromTwoWithInvalid(invalid: boolean, firstPart: bigint, secondPart: bigint): bigint {
	const oneHundredTwentyBitMask = (1n << SCALAR_PART_BIT_LENGTH) - 1n
	const normalizedFirstPart = firstPart & oneHundredTwentyBitMask
	const normalizedSecondPart = secondPart & oneHundredTwentyBitMask
	const highestBit = invalid ? 0n : 1n
	return (highestBit << (SCALAR_TOTAL_BITS - 1n)) | (normalizedFirstPart << SCALAR_PART_BIT_LENGTH) | normalizedSecondPart
}

function formatSignedDecimal(value: bigint) {
	const isNegative = value < 0n
	const absoluteValue = isNegative ? -value : value
	const integerPart = absoluteValue / SCALAR_DECIMAL_BASE
	const fractionalPart = absoluteValue % SCALAR_DECIMAL_BASE
	if (fractionalPart === 0n) return `${isNegative ? '-' : ''}${integerPart.toString()}`
	const fractionalString = fractionalPart.toString().padStart(Number(SCALAR_DECIMALS), '0').replace(/0+$/, '')
	return `${isNegative ? '-' : ''}${integerPart.toString()}.${fractionalString}`
}

function validateTickIndex(question: ScalarQuestionDetails, tickIndex: bigint) {
	if (question.numTicks <= 0n) throw new Error('Scalar question numTicks must be positive')
	if (tickIndex < 0n || tickIndex > question.numTicks) throw new Error('Tick index is out of range')
}

export function getScalarSliderProgress(tickIndex: bigint, numTicks: bigint) {
	if (numTicks <= 0n) throw new Error('Scalar question numTicks must be positive')
	if (tickIndex < 0n || tickIndex > numTicks) throw new Error('Tick index is out of range')
	return Number((tickIndex * 100n) / numTicks)
}

export function getScalarSliderFillWidth(tickIndex: bigint, numTicks: bigint) {
	const fraction = Number(tickIndex) / Number(numTicks)
	return `calc(${fraction * 100}% - ${fraction}rem + 0.5rem)`
}

export function clampScalarTickIndex(tickIndex: bigint, numTicks: bigint) {
	if (numTicks <= 0n) throw new Error('Scalar question numTicks must be positive')
	if (tickIndex < 0n) return 0n
	if (tickIndex > numTicks) return numTicks
	return tickIndex
}

export function parseScalarFormInputs({ scalarIncrement, scalarMax, scalarMin }: ScalarFormInputs) {
	const displayValueMin = parseScalarDecimalInput(scalarMin, 'Scalar min')
	const displayValueMax = parseScalarDecimalInput(scalarMax, 'Scalar max')
	const increment = parseScalarDecimalInput(scalarIncrement, 'Scalar increment')

	if (increment <= 0n) throw new Error('Scalar increment must be greater than 0')
	if (displayValueMax <= displayValueMin) throw new Error('Scalar max must be greater than scalar min')

	const range = displayValueMax - displayValueMin
	if (range % increment !== 0n) {
		throw new Error('Scalar min, max, and increment do not produce a whole number of ticks')
	}

	const numTicks = range / increment
	if (numTicks <= 1n) throw new Error('Scalar inputs must produce more than 1 tick')

	return {
		displayValueMax,
		displayValueMin,
		numTicks,
	}
}

export function getScalarOutcomeIndex(question: ScalarQuestionDetails, tickIndex: bigint) {
	validateTickIndex(question, tickIndex)
	return combineUint256FromTwoWithInvalid(false, question.numTicks - tickIndex, tickIndex)
}

export function formatScalarOutcomeLabel(question: ScalarQuestionDetails, tickIndex: bigint) {
	validateTickIndex(question, tickIndex)
	const scalarRange = question.displayValueMax - question.displayValueMin
	const scalarValue = question.displayValueMin + (tickIndex * scalarRange) / question.numTicks
	const formattedValue = formatSignedDecimal(scalarValue)
	return question.answerUnit === '' ? formattedValue : `${formattedValue} ${question.answerUnit}`
}
