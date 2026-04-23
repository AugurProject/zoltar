/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getUseQuestionForPoolState } from '../lib/securityPoolNavigation.js'

void describe('security pool navigation', () => {
	void test('clears the selected pool address when reusing a question for create pool', () => {
		expect(getUseQuestionForPoolState('0x123')).toEqual({
			marketId: '0x123',
			securityPoolAddress: '',
		})
	})
})
