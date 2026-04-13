/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import type { MarketDetails } from '../types/contracts.js'
import { getQuestionTitle } from '../components/Question.js'

const questionBase = {
	answerUnit: '',
	createdAt: 1n,
	description: 'Description',
	displayValueMax: 1n,
	displayValueMin: 0n,
	endTime: 2n,
	exists: true,
	marketType: 'binary',
	numTicks: 1n,
	outcomeLabels: ['Yes', 'No'],
	questionId: '0x0000000000000000000000000000000000000000000000000000000000000001',
	startTime: 0n,
	title: 'Question title',
} satisfies MarketDetails

void describe('question helpers', () => {
	void test('falls back to Untitled question when the title is empty', () => {
		expect(getQuestionTitle({ ...questionBase, title: '' })).toBe('Untitled question')
	})

	void test('keeps a non-empty title unchanged', () => {
		expect(getQuestionTitle(questionBase)).toBe('Question title')
	})
})
