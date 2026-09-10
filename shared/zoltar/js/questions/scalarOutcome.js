const SCALAR_DECIMAL_PLACES = 18;
const SCALAR_DECIMAL_BASE = 10n ** BigInt(SCALAR_DECIMAL_PLACES);
const SCALAR_PART_BIT_LENGTH = 120n;
const SCALAR_TOTAL_BITS = 256n;
const SCALAR_PART_MASK = (1n << SCALAR_PART_BIT_LENGTH) - 1n;
const SCALAR_RESERVED_BITS_MASK = ((1n << 15n) - 1n) << 240n;
export const MAX_PRECISE_SCALAR_TICK_COUNT = BigInt(Number.MAX_SAFE_INTEGER);
function combineUint256FromTwoWithInvalid(invalid, firstPart, secondPart) {
    const normalizedFirstPart = firstPart & SCALAR_PART_MASK;
    const normalizedSecondPart = secondPart & SCALAR_PART_MASK;
    const highestBit = invalid ? 0n : 1n;
    return (highestBit << (SCALAR_TOTAL_BITS - 1n)) | (normalizedFirstPart << SCALAR_PART_BIT_LENGTH) | normalizedSecondPart;
}
function validateTickIndex(question, tickIndex) {
    if (question.numTicks <= 0n)
        throw new Error('Scalar question numTicks must be positive');
    if (tickIndex < 0n || tickIndex > question.numTicks)
        throw new Error('Tick index is out of range');
}
function splitScalarOutcomeIndex(outcomeIndex) {
    const invalid = outcomeIndex >> (SCALAR_TOTAL_BITS - 1n) === 0n;
    const firstPart = (outcomeIndex >> SCALAR_PART_BIT_LENGTH) & SCALAR_PART_MASK;
    const secondPart = outcomeIndex & SCALAR_PART_MASK;
    return { invalid, firstPart, secondPart };
}
export function clampScalarTickIndex(tickIndex, numTicks) {
    if (numTicks <= 0n)
        throw new Error('Scalar question numTicks must be positive');
    if (tickIndex < 0n)
        return 0n;
    if (tickIndex > numTicks)
        return numTicks;
    return tickIndex;
}
export function formatScalarDisplayValue(value) {
    const isNegative = value < 0n;
    const absoluteValue = isNegative ? -value : value;
    const integerPart = absoluteValue / SCALAR_DECIMAL_BASE;
    const fractionalPart = absoluteValue % SCALAR_DECIMAL_BASE;
    if (fractionalPart === 0n)
        return `${isNegative ? '-' : ''}${integerPart.toString()}`;
    const fractionalString = fractionalPart.toString().padStart(SCALAR_DECIMAL_PLACES, '0').replace(/0+$/, '');
    return `${isNegative ? '-' : ''}${integerPart.toString()}.${fractionalString}`;
}
export function getScalarOutcomeIndex(question, tickIndex) {
    validateTickIndex(question, tickIndex);
    return combineUint256FromTwoWithInvalid(false, question.numTicks - tickIndex, tickIndex);
}
export function getScalarDisplayValue(question, tickIndex) {
    validateTickIndex(question, tickIndex);
    const scalarRange = question.displayValueMax - question.displayValueMin;
    if (scalarRange <= 0n)
        throw new Error('Scalar question display range must be positive');
    return question.displayValueMin + (tickIndex * scalarRange) / question.numTicks;
}
export function getScalarTickIndexForDisplayValue(question, displayValue) {
    if (question.numTicks <= 0n)
        throw new Error('Scalar question numTicks must be positive');
    const scalarRange = question.displayValueMax - question.displayValueMin;
    if (scalarRange <= 0n)
        throw new Error('Scalar question display range must be positive');
    if (displayValue < question.displayValueMin || displayValue > question.displayValueMax)
        return undefined;
    const offset = displayValue - question.displayValueMin;
    const candidateTick = offset === 0n ? 0n : (offset * question.numTicks + scalarRange - 1n) / scalarRange;
    if (candidateTick > question.numTicks)
        return undefined;
    return getScalarDisplayValue(question, candidateTick) === displayValue ? candidateTick : undefined;
}
export function formatScalarOutcomeLabel(question, tickIndex) {
    const scalarValue = getScalarDisplayValue(question, tickIndex);
    const formattedValue = formatScalarDisplayValue(scalarValue);
    return question.answerUnit === '' ? formattedValue : `${formattedValue} ${question.answerUnit}`;
}
export function getScalarOutcomeIndexDescriptor(question, outcomeIndex) {
    if (question.numTicks <= 0n || outcomeIndex < 0n || outcomeIndex >= 1n << SCALAR_TOTAL_BITS)
        return { kind: 'malformed' };
    if ((outcomeIndex & SCALAR_RESERVED_BITS_MASK) !== 0n)
        return { kind: 'malformed' };
    const { invalid, firstPart, secondPart } = splitScalarOutcomeIndex(outcomeIndex);
    if (invalid)
        return firstPart === 0n && secondPart === 0n ? { kind: 'invalid' } : { kind: 'malformed' };
    if (firstPart + secondPart !== question.numTicks)
        return { kind: 'malformed' };
    if (secondPart > question.numTicks)
        return { kind: 'malformed' };
    return { kind: 'tick', tickIndex: secondPart };
}
export function isValidScalarOutcomeIndex(question, outcomeIndex) {
    return getScalarOutcomeIndexDescriptor(question, outcomeIndex).kind !== 'malformed';
}
export function formatScalarOutcomeIndexLabel(question, outcomeIndex) {
    const descriptor = getScalarOutcomeIndexDescriptor(question, outcomeIndex);
    if (descriptor.kind === 'invalid')
        return 'Invalid';
    if (descriptor.kind === 'malformed')
        throw new Error('Scalar outcome index is malformed');
    return formatScalarOutcomeLabel(question, descriptor.tickIndex);
}
