import { parseDecimalInput } from './decimal.js'

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
const SCALAR_PART_MASK = (1n << SCALAR_PART_BIT_LENGTH) - 1n

type ScalarOutcomeIndexDescriptor =
	| {
			kind: 'invalid'
	  }
	| {
			kind: 'malformed'
	  }
	| {
			kind: 'tick'
			tickIndex: bigint
	  }

function combineUint256FromTwoWithInvalid(invalid: boolean, firstPart: bigint, secondPart: bigint): bigint {
	const normalizedFirstPart = firstPart & SCALAR_PART_MASK
	const normalizedSecondPart = secondPart & SCALAR_PART_MASK
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

function splitScalarOutcomeIndex(outcomeIndex: bigint) {
	const invalid = outcomeIndex >> (SCALAR_TOTAL_BITS - 1n) === 0n
	const firstPart = (outcomeIndex >> SCALAR_PART_BIT_LENGTH) & SCALAR_PART_MASK
	const secondPart = outcomeIndex & SCALAR_PART_MASK
	return { invalid, firstPart, secondPart }
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
	const displayValueMin = parseDecimalInput(scalarMin, 'Scalar min', Number(SCALAR_DECIMALS))
	const displayValueMax = parseDecimalInput(scalarMax, 'Scalar max', Number(SCALAR_DECIMALS))
	const increment = parseDecimalInput(scalarIncrement, 'Scalar increment', Number(SCALAR_DECIMALS))

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

export function getScalarOutcomeIndexDescriptor(question: ScalarQuestionDetails, outcomeIndex: bigint): ScalarOutcomeIndexDescriptor {
	if (question.numTicks <= 0n) return { kind: 'malformed' }

	const { invalid, firstPart, secondPart } = splitScalarOutcomeIndex(outcomeIndex)
	if (invalid) {
		return firstPart === 0n && secondPart === 0n ? { kind: 'invalid' } : { kind: 'malformed' }
	}

	const tickIndex = secondPart
	if (firstPart + secondPart !== question.numTicks) return { kind: 'malformed' }
	if (tickIndex < 0n || tickIndex > question.numTicks) return { kind: 'malformed' }
	return { kind: 'tick', tickIndex }
}

export function isValidScalarOutcomeIndex(question: ScalarQuestionDetails, outcomeIndex: bigint) {
	return getScalarOutcomeIndexDescriptor(question, outcomeIndex).kind !== 'malformed'
}

export function formatScalarOutcomeIndexLabel(question: ScalarQuestionDetails, outcomeIndex: bigint) {
	const descriptor = getScalarOutcomeIndexDescriptor(question, outcomeIndex)
	if (descriptor.kind === 'invalid') return 'Invalid'
	if (descriptor.kind === 'malformed') throw new Error('Scalar outcome index is malformed')
	return formatScalarOutcomeLabel(question, descriptor.tickIndex)
}
