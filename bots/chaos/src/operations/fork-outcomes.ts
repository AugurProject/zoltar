import type { QuestionSnapshot } from './types.ts'

const SCALAR_SAMPLE_INTERVALS = 15n

function scalarOutcome(numTicks: bigint, firstPart: bigint) {
	return ((1n << 255n) | (firstPart << 120n) | (numTicks - firstPart)).toString()
}

/**
 * Returns a bounded, deterministic set of well-formed outcomes for unattended
 * child workflows. Categorical domains are complete. Scalar domains include
 * Invalid plus evenly-spaced points across the full tick range so discovery
 * remains bounded even when numTicks approaches uint120.max.
 */
export function validForkOutcomeCandidates(question: QuestionSnapshot | undefined): string[] {
	if (question === undefined) return []
	if (question.kind !== 'scalar') return Array.from({ length: question.outcomeLabels.length + 1 }, (_, outcome) => outcome.toString())
	const numTicks = BigInt(question.numTicks)
	if (numTicks === 0n) return []
	const outcomes = new Set<string>(['0'])
	for (let sample = 0n; sample <= SCALAR_SAMPLE_INTERVALS; sample += 1n) {
		outcomes.add(scalarOutcome(numTicks, (numTicks * sample) / SCALAR_SAMPLE_INTERVALS))
	}
	return [...outcomes]
}

function isValidForkOutcome(question: QuestionSnapshot, rawOutcome: string) {
	const outcome = BigInt(rawOutcome)
	if (outcome < 0n || outcome >= 1n << 256n) return false
	if (question.kind !== 'scalar') return outcome <= BigInt(question.outcomeLabels.length)
	if (outcome === 0n) return true
	const uint120Mask = (1n << 120n) - 1n
	const reservedBits = (outcome >> 240n) & ((1n << 15n) - 1n)
	if (reservedBits !== 0n || outcome >> 255n !== 1n) return false
	const firstPart = (outcome >> 120n) & uint120Mask
	const secondPart = outcome & uint120Mask
	return firstPart + secondPart === BigInt(question.numTicks)
}

/** Includes already-deployed canonical routes even when a scalar outcome was not sampled. */
export function validForkOutcomeRoutes(question: QuestionSnapshot | undefined, knownOutcomes: readonly string[] = []): string[] {
	if (question === undefined) return []
	const outcomes = new Set(validForkOutcomeCandidates(question))
	for (const outcome of knownOutcomes) if (isValidForkOutcome(question, outcome)) outcomes.add(BigInt(outcome).toString())
	return [...outcomes]
}
