import { parseDecimalInput } from './decimal.js'
import { getVisualRatio } from './visualMetrics.js'
import { formatScalarOutcomeIndexLabel as formatSharedScalarOutcomeIndexLabel, formatScalarOutcomeLabel as formatSharedScalarOutcomeLabel, MAX_PRECISE_SCALAR_TICK_COUNT, type ScalarQuestionDetails } from '@zoltar/shared/scalarOutcome'

export {
	clampScalarTickIndex,
	formatScalarDisplayValue,
	getScalarDisplayValue,
	getScalarOutcomeIndex,
	getScalarOutcomeIndexDescriptor,
	getScalarTickIndexForDisplayValue,
	isValidScalarOutcomeIndex,
	MAX_PRECISE_SCALAR_TICK_COUNT,
} from '@zoltar/shared/scalarOutcome'

function keepScalarUnitWithValue(label: string) {
	return label.replace(' ', '\u00a0')
}

export function formatScalarOutcomeLabel(question: ScalarQuestionDetails, tickIndex: bigint) {
	return keepScalarUnitWithValue(formatSharedScalarOutcomeLabel(question, tickIndex))
}

export function formatScalarOutcomeIndexLabel(question: ScalarQuestionDetails, outcomeIndex: bigint) {
	return keepScalarUnitWithValue(formatSharedScalarOutcomeIndexLabel(question, outcomeIndex))
}

type ScalarFormInputs = {
	scalarIncrement: string
	scalarMax: string
	scalarMin: string
}

const SCALAR_DECIMAL_PLACES = 18
const SCALAR_PART_BIT_LENGTH = 120n
const SCALAR_PART_MASK = (1n << SCALAR_PART_BIT_LENGTH) - 1n
const SCALAR_SIGNED_MIN = -(1n << 255n)
const SCALAR_SIGNED_MAX = (1n << 255n) - 1n

export function getScalarSliderProgress(tickIndex: bigint, numTicks: bigint) {
	if (numTicks <= 0n) throw new Error('Scalar question numTicks must be positive')
	if (tickIndex < 0n || tickIndex > numTicks) throw new Error('Tick index is out of range')
	return Math.floor((getVisualRatio({ value: tickIndex, maxValue: numTicks }) ?? 0) * 100)
}

export function getScalarSliderFillWidth(tickIndex: bigint, numTicks: bigint) {
	const fraction = getVisualRatio({ value: tickIndex, maxValue: numTicks }) ?? 0
	return `calc(${fraction * 100}% - ${fraction}rem + 0.5rem)`
}

export function parseScalarFormInputs({ scalarIncrement, scalarMax, scalarMin }: ScalarFormInputs) {
	const displayValueMin = parseDecimalInput(scalarMin, 'Scalar min', SCALAR_DECIMAL_PLACES)
	const displayValueMax = parseDecimalInput(scalarMax, 'Scalar max', SCALAR_DECIMAL_PLACES)
	const increment = parseDecimalInput(scalarIncrement, 'Scalar increment', SCALAR_DECIMAL_PLACES)

	if (displayValueMin < SCALAR_SIGNED_MIN || displayValueMin > SCALAR_SIGNED_MAX) throw new Error('Scalar min is outside the supported range')
	if (displayValueMax < SCALAR_SIGNED_MIN || displayValueMax > SCALAR_SIGNED_MAX) throw new Error('Scalar max is outside the supported range')
	if (increment <= 0n) throw new Error('Scalar increment must be greater than 0')
	if (displayValueMax <= displayValueMin) throw new Error('Scalar max must be greater than scalar min')

	const range = displayValueMax - displayValueMin
	if (range % increment !== 0n) throw new Error('Scalar min, max, and increment do not produce a whole number of ticks')

	const numTicks = range / increment
	if (numTicks <= 1n) throw new Error('Scalar inputs must produce more than 1 tick')
	if (numTicks > SCALAR_PART_MASK) throw new Error('Scalar range and increment produce too many ticks. Narrow the range or increase the increment.')
	if (numTicks > MAX_PRECISE_SCALAR_TICK_COUNT) throw new Error('Scalar range and increment produce too many ticks. Narrow the range or increase the increment.')

	return {
		displayValueMax,
		displayValueMin,
		numTicks,
	}
}
