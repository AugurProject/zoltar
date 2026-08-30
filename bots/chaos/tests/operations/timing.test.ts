import { describe, expect, test } from 'bun:test'
import { assertWorkflowPrerequisiteLimit, MAXIMUM_WORKFLOW_PREREQUISITE_COUNT, MINIMUM_WORKFLOW_VALIDITY_BLOCKS, requiredTimestampSafetySeconds, requiredTimestampSubmissionSafetySeconds, requiredWorkflowSafetyBlocks, timestampDeadlineHasRequiredSafety } from '../../src/operations/timing.ts'

const options = { maximumBlockIntervalSeconds: 15, seed: 1 }

describe('deadline timing safety', () => {
	test('separates block-clock transport windows from timestamp next-block safety', () => {
		expect(MAXIMUM_WORKFLOW_PREREQUISITE_COUNT).toBe(2)
		expect(MINIMUM_WORKFLOW_VALIDITY_BLOCKS).toBe(75)
		expect(requiredWorkflowSafetyBlocks()).toBe(25n)
		expect(requiredWorkflowSafetyBlocks(1)).toBe(62n)
		expect(requiredWorkflowSafetyBlocks(2)).toBe(99n)
		expect(requiredTimestampSafetySeconds(options)).toBe(60n)
		expect(requiredTimestampSafetySeconds(options, 1)).toBe(255n)
		expect(requiredTimestampSafetySeconds(options, 2)).toBe(450n)
		expect(requiredTimestampSafetySeconds({ ...options, maximumBlockIntervalSeconds: 30 }, 1)).toBe(450n)
	})

	test('uses the greater of the one-minute signing floor and one-block cadence', () => {
		expect(requiredTimestampSubmissionSafetySeconds(15)).toBe(60n)
		expect(requiredTimestampSubmissionSafetySeconds(90)).toBe(90n)
		expect(timestampDeadlineHasRequiredSafety(1_000n, 1_060n, options)).toBeFalse()
		expect(timestampDeadlineHasRequiredSafety(1_000n, 1_061n, options)).toBeTrue()
	})

	test('fails closed when a plan exceeds the validity-floor prerequisite assumption', () => {
		expect(assertWorkflowPrerequisiteLimit({ id: 'supported', steps: [{}, {}, {}] })).toBe(2)
		expect(() => assertWorkflowPrerequisiteLimit({ id: 'too-many', steps: [{}, {}, {}, {}] })).toThrow('at most 2 pre-terminal steps')
	})

	test('rejects invalid cadence and prerequisite inputs', () => {
		expect(() => requiredTimestampSafetySeconds({ ...options, maximumBlockIntervalSeconds: 0 })).toThrow('positive safe integer')
		expect(() => requiredTimestampSubmissionSafetySeconds(1.5)).toThrow('positive safe integer')
		expect(() => requiredWorkflowSafetyBlocks(-1)).toThrow('non-negative safe integer')
	})
})
