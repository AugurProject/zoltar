/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { resolveSecurityPoolQuestionLookupInput } from '../hooks/useSecurityPoolCreation.js'

void describe('security pool creation question lookup input', () => {
	void test('returns a normalized question id only for loadable inputs', () => {
		expect(resolveSecurityPoolQuestionLookupInput('')).toBeUndefined()
		expect(resolveSecurityPoolQuestionLookupInput('   ')).toBeUndefined()
		expect(resolveSecurityPoolQuestionLookupInput('not-a-question-id')).toBeUndefined()
		expect(resolveSecurityPoolQuestionLookupInput(' 123 ')).toBe('123')
		expect(resolveSecurityPoolQuestionLookupInput(' 0x123 ')).toBe('0x123')
	})
})
