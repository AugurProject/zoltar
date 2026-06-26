export type ScalarParityQuestion = {
	name: string
	answerUnit: string
	displayValueMax: bigint
	displayValueMin: bigint
	numTicks: bigint
}

export type ScalarParityLabelFixture = {
	name: string
	expectedLabel: string
	questionName: string
	tickIndex: bigint
}

export type ScalarParityOutcomeIndexDescriptor =
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

export type ScalarParityEncodingFixture = {
	name: string
	expectedDescriptor: ScalarParityOutcomeIndexDescriptor
	expectedLabel: string
	firstPart: bigint
	invalid: boolean
	questionName: string
	secondPart: bigint
}

export const SCALAR_PARITY_DECIMALS = 18n
export const SCALAR_PARITY_DECIMAL_BASE = 10n ** SCALAR_PARITY_DECIMALS
export const SCALAR_PARITY_PART_BIT_LENGTH = 120n
export const SCALAR_PARITY_TOTAL_BITS = 256n
export const SCALAR_PARITY_PART_MASK = (1n << SCALAR_PARITY_PART_BIT_LENGTH) - 1n
export const SCALAR_PARITY_UINT120_MAX = SCALAR_PARITY_PART_MASK
export const SCALAR_PARITY_INT256_MIN = -(1n << 255n)
export const SCALAR_PARITY_INT256_MAX = (1n << 255n) - 1n

const ONE = SCALAR_PARITY_DECIMAL_BASE

export const SCALAR_PARITY_QUESTIONS: ScalarParityQuestion[] = [
	{
		name: 'tenths-positive',
		answerUnit: 'km',
		displayValueMax: 10n * ONE,
		displayValueMin: ONE,
		numTicks: 90n,
	},
	{
		name: 'signed-eighths',
		answerUnit: 'units',
		displayValueMax: 5n * ONE,
		displayValueMin: -5n * ONE,
		numTicks: 8n,
	},
	{
		name: 'repeating-sevenths',
		answerUnit: '',
		displayValueMax: 2n * ONE,
		displayValueMin: -ONE,
		numTicks: 7n,
	},
	{
		name: 'uint120-boundary',
		answerUnit: '',
		displayValueMax: 1n,
		displayValueMin: 0n,
		numTicks: SCALAR_PARITY_UINT120_MAX,
	},
	{
		name: 'int256-extreme',
		answerUnit: '',
		displayValueMax: SCALAR_PARITY_INT256_MAX,
		displayValueMin: SCALAR_PARITY_INT256_MIN,
		numTicks: 17n,
	},
]

export const SCALAR_PARITY_LABEL_FIXTURES: ScalarParityLabelFixture[] = [
	{ name: 'positive lower endpoint', questionName: 'tenths-positive', tickIndex: 0n, expectedLabel: '1 km' },
	{ name: 'positive first tenth', questionName: 'tenths-positive', tickIndex: 1n, expectedLabel: '1.1 km' },
	{ name: 'positive middle tenth', questionName: 'tenths-positive', tickIndex: 44n, expectedLabel: '5.4 km' },
	{ name: 'positive penultimate tenth', questionName: 'tenths-positive', tickIndex: 89n, expectedLabel: '9.9 km' },
	{ name: 'positive upper endpoint', questionName: 'tenths-positive', tickIndex: 90n, expectedLabel: '10 km' },
	{ name: 'signed lower endpoint', questionName: 'signed-eighths', tickIndex: 0n, expectedLabel: '-5 units' },
	{ name: 'signed fractional tick', questionName: 'signed-eighths', tickIndex: 1n, expectedLabel: '-3.75 units' },
	{ name: 'signed zero crossing', questionName: 'signed-eighths', tickIndex: 4n, expectedLabel: '0 units' },
	{ name: 'signed upper endpoint', questionName: 'signed-eighths', tickIndex: 8n, expectedLabel: '5 units' },
	{ name: 'repeating lower endpoint', questionName: 'repeating-sevenths', tickIndex: 0n, expectedLabel: '-1' },
	{ name: 'repeating negative truncation', questionName: 'repeating-sevenths', tickIndex: 1n, expectedLabel: '-0.571428571428571429' },
	{ name: 'repeating positive truncation', questionName: 'repeating-sevenths', tickIndex: 6n, expectedLabel: '1.571428571428571428' },
	{ name: 'repeating upper endpoint', questionName: 'repeating-sevenths', tickIndex: 7n, expectedLabel: '2' },
	{ name: 'uint120 lower endpoint', questionName: 'uint120-boundary', tickIndex: 0n, expectedLabel: '0' },
	{ name: 'uint120 upper endpoint', questionName: 'uint120-boundary', tickIndex: SCALAR_PARITY_UINT120_MAX, expectedLabel: '0.000000000000000001' },
	{
		name: 'int256 lower endpoint',
		questionName: 'int256-extreme',
		tickIndex: 0n,
		expectedLabel: '-57896044618658097711785492504343953926634992332820282019728.792003956564819968',
	},
	{
		name: 'int256 interior tick',
		questionName: 'int256-extreme',
		tickIndex: 8n,
		expectedLabel: '-3405649683450476335987381912020232583919705431342369530572.281882585680283528',
	},
	{
		name: 'int256 upper endpoint',
		questionName: 'int256-extreme',
		tickIndex: 17n,
		expectedLabel: '57896044618658097711785492504343953926634992332820282019728.792003956564819967',
	},
]

export const SCALAR_PARITY_ENCODING_FIXTURES: ScalarParityEncodingFixture[] = [
	{
		name: 'canonical invalid answer',
		questionName: 'tenths-positive',
		invalid: true,
		firstPart: 0n,
		secondPart: 0n,
		expectedDescriptor: { kind: 'invalid' },
		expectedLabel: 'Invalid',
	},
	{
		name: 'invalid flag with payload is malformed',
		questionName: 'tenths-positive',
		invalid: true,
		firstPart: 1n,
		secondPart: 0n,
		expectedDescriptor: { kind: 'malformed' },
		expectedLabel: 'Malformed',
	},
	{
		name: 'high-bit payload with wrong sum is malformed',
		questionName: 'tenths-positive',
		invalid: false,
		firstPart: 89n,
		secondPart: 0n,
		expectedDescriptor: { kind: 'malformed' },
		expectedLabel: 'Malformed',
	},
	{
		name: 'high-bit lower endpoint',
		questionName: 'signed-eighths',
		invalid: false,
		firstPart: 8n,
		secondPart: 0n,
		expectedDescriptor: { kind: 'tick', tickIndex: 0n },
		expectedLabel: '-5 units',
	},
	{
		name: 'high-bit fractional tick',
		questionName: 'signed-eighths',
		invalid: false,
		firstPart: 7n,
		secondPart: 1n,
		expectedDescriptor: { kind: 'tick', tickIndex: 1n },
		expectedLabel: '-3.75 units',
	},
	{
		name: 'high-bit uint120 upper endpoint',
		questionName: 'uint120-boundary',
		invalid: false,
		firstPart: 0n,
		secondPart: SCALAR_PARITY_UINT120_MAX,
		expectedDescriptor: { kind: 'tick', tickIndex: SCALAR_PARITY_UINT120_MAX },
		expectedLabel: '0.000000000000000001',
	},
	{
		name: 'masked overflow payload remains malformed',
		questionName: 'tenths-positive',
		invalid: false,
		firstPart: SCALAR_PARITY_UINT120_MAX + 10n,
		secondPart: 80n,
		expectedDescriptor: { kind: 'malformed' },
		expectedLabel: 'Malformed',
	},
]

export function getScalarParityQuestion(questionName: string) {
	const question = SCALAR_PARITY_QUESTIONS.find(candidate => candidate.name === questionName)
	if (question === undefined) throw new Error(`Unknown scalar parity question: ${questionName}`)
	return question
}

export function combineScalarParityOutcomeIndex(invalid: boolean, firstPart: bigint, secondPart: bigint) {
	const normalizedFirstPart = firstPart & SCALAR_PARITY_PART_MASK
	const normalizedSecondPart = secondPart & SCALAR_PARITY_PART_MASK
	const highestBit = invalid ? 0n : 1n
	return (highestBit << (SCALAR_PARITY_TOTAL_BITS - 1n)) | (normalizedFirstPart << SCALAR_PARITY_PART_BIT_LENGTH) | normalizedSecondPart
}

export function getScalarParityOutcomeIndex(question: ScalarParityQuestion, tickIndex: bigint) {
	validateScalarParityTickIndex(question, tickIndex)
	return combineScalarParityOutcomeIndex(false, question.numTicks - tickIndex, tickIndex)
}

export function formatScalarParityLabel(question: ScalarParityQuestion, tickIndex: bigint) {
	validateScalarParityTickIndex(question, tickIndex)
	const scalarRange = question.displayValueMax - question.displayValueMin
	const scalarValue = question.displayValueMin + (tickIndex * scalarRange) / question.numTicks
	const formattedValue = formatSignedDecimal(scalarValue)
	return question.answerUnit === '' ? formattedValue : `${formattedValue} ${question.answerUnit}`
}

export function describeScalarParityOutcomeIndex(question: ScalarParityQuestion, outcomeIndex: bigint): ScalarParityOutcomeIndexDescriptor {
	if (question.numTicks <= 0n) return { kind: 'malformed' }
	const { invalid, firstPart, secondPart } = splitScalarParityOutcomeIndex(outcomeIndex)
	if (invalid) return firstPart === 0n && secondPart === 0n ? { kind: 'invalid' } : { kind: 'malformed' }
	if (firstPart + secondPart !== question.numTicks) return { kind: 'malformed' }
	return { kind: 'tick', tickIndex: secondPart }
}

export function isScalarParityMalformedOutcomeIndex(question: ScalarParityQuestion, outcomeIndex: bigint) {
	return describeScalarParityOutcomeIndex(question, outcomeIndex).kind === 'malformed'
}

export function formatScalarParityOutcomeName(question: ScalarParityQuestion, outcomeIndex: bigint) {
	const descriptor = describeScalarParityOutcomeIndex(question, outcomeIndex)
	if (descriptor.kind === 'invalid') return 'Invalid'
	if (descriptor.kind === 'malformed') return 'Malformed'
	return formatScalarParityLabel(question, descriptor.tickIndex)
}

function validateScalarParityTickIndex(question: ScalarParityQuestion, tickIndex: bigint) {
	if (question.numTicks <= 0n) throw new Error('Scalar question numTicks must be positive')
	if (tickIndex < 0n || tickIndex > question.numTicks) throw new Error('Tick index is out of range')
}

function splitScalarParityOutcomeIndex(outcomeIndex: bigint) {
	const invalid = outcomeIndex >> (SCALAR_PARITY_TOTAL_BITS - 1n) === 0n
	const firstPart = (outcomeIndex >> SCALAR_PARITY_PART_BIT_LENGTH) & SCALAR_PARITY_PART_MASK
	const secondPart = outcomeIndex & SCALAR_PARITY_PART_MASK
	return { invalid, firstPart, secondPart }
}

function formatSignedDecimal(value: bigint) {
	const isNegative = value < 0n
	const absoluteValue = isNegative ? -value : value
	const integerPart = absoluteValue / SCALAR_PARITY_DECIMAL_BASE
	const fractionalPart = absoluteValue % SCALAR_PARITY_DECIMAL_BASE
	if (fractionalPart === 0n) return `${isNegative ? '-' : ''}${integerPart.toString()}`
	const fractionalString = fractionalPart.toString().padStart(Number(SCALAR_PARITY_DECIMALS), '0').replace(/0+$/, '')
	return `${isNegative ? '-' : ''}${integerPart.toString()}.${fractionalString}`
}
