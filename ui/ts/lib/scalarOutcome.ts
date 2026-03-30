type ScalarQuestionDetails = {
	answerUnit: string
	displayValueMax: bigint
	displayValueMin: bigint
	numTicks: bigint
}

const SCALAR_DECIMALS = 18n
const SCALAR_DECIMAL_BASE = 10n ** SCALAR_DECIMALS
const SCALAR_PART_BIT_LENGTH = 120n
const SCALAR_TOTAL_BITS = 256n

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
	if (fractionalPart === 0n) return `${ isNegative ? '-' : '' }${ integerPart.toString() }`
	const fractionalString = fractionalPart.toString().padStart(Number(SCALAR_DECIMALS), '0').replace(/0+$/, '')
	return `${ isNegative ? '-' : '' }${ integerPart.toString() }.${ fractionalString }`
}

export function getScalarOutcomeIndex(question: ScalarQuestionDetails, tickIndex: bigint) {
	if (tickIndex < 0n || tickIndex > question.numTicks) throw new Error('Tick index is out of range')
	return combineUint256FromTwoWithInvalid(false, question.numTicks - tickIndex, tickIndex)
}

export function formatScalarOutcomeLabel(question: ScalarQuestionDetails, tickIndex: bigint) {
	if (tickIndex < 0n || tickIndex > question.numTicks) throw new Error('Tick index is out of range')
	const tradeInterval = (question.displayValueMax - question.displayValueMin) / question.numTicks
	const scalarValue = question.displayValueMin + tickIndex * tradeInterval
	const formattedValue = formatSignedDecimal(scalarValue)
	return question.answerUnit === '' ? formattedValue : `${ formattedValue } ${ question.answerUnit }`
}
