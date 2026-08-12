import { describe, expect, test } from 'bun:test'
import { formatScalarOutcomeIndexLabel, formatScalarOutcomeLabel, getScalarOutcomeIndex, getScalarOutcomeIndexDescriptor } from './scalarOutcome'
import { combineScalarParityOutcomeIndex, getScalarParityQuestion, SCALAR_PARITY_ENCODING_FIXTURES, SCALAR_PARITY_LABEL_FIXTURES } from './testing/scalarOutcomeParityFixtures'

describe('shared scalar outcome codec', () => {
	for (const fixture of SCALAR_PARITY_LABEL_FIXTURES) {
		test(`formats ${fixture.name}`, () => {
			const question = getScalarParityQuestion(fixture.questionName)
			expect(formatScalarOutcomeLabel(question, fixture.tickIndex)).toBe(fixture.expectedLabel)
			expect(formatScalarOutcomeIndexLabel(question, getScalarOutcomeIndex(question, fixture.tickIndex))).toBe(fixture.expectedLabel)
		})
	}

	for (const fixture of SCALAR_PARITY_ENCODING_FIXTURES) {
		test(`decodes ${fixture.name}`, () => {
			const question = getScalarParityQuestion(fixture.questionName)
			const outcomeIndex = combineScalarParityOutcomeIndex(fixture.invalid, fixture.firstPart, fixture.secondPart)
			expect(getScalarOutcomeIndexDescriptor(question, outcomeIndex)).toEqual(fixture.expectedDescriptor)
			if (fixture.expectedDescriptor.kind === 'malformed') expect(() => formatScalarOutcomeIndexLabel(question, outcomeIndex)).toThrow('malformed')
			else expect(formatScalarOutcomeIndexLabel(question, outcomeIndex)).toBe(fixture.expectedLabel)
		})
	}
})
