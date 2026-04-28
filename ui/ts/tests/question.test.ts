/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import type { MarketDetails } from '../types/contracts.js'
import { getQuestionSummaryFields, getQuestionTitle } from '../components/Question.js'

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

	void test('builds binary question summary fields without a type label', () => {
		const fields = getQuestionSummaryFields(questionBase)

		expect(fields.map(field => field.label)).toEqual(['Question ID', 'Created', 'End Time', 'Outcomes'])
		expect(fields.some(field => field.label === 'Type')).toBe(false)
		expect(fields.find(field => field.label === 'Outcomes')).toEqual({
			kind: 'text',
			label: 'Outcomes',
			value: 'Yes, No, Invalid',
		})
	})

	void test('builds scalar question summary fields with scalar-specific details', () => {
		const fields = getQuestionSummaryFields({
			...questionBase,
			answerUnit: 'USD',
			displayValueMax: 10n,
			displayValueMin: 1n,
			marketType: 'scalar',
			numTicks: 100n,
			outcomeLabels: [],
		})

		expect(fields.map(field => field.label)).toEqual(['Question ID', 'Created', 'End Time', 'Outcomes', 'Ticks', 'Display Range', 'Answer Unit'])
		expect(fields.some(field => field.label === 'Type')).toBe(false)
		expect(fields.find(field => field.label === 'Outcomes')).toEqual({
			kind: 'text',
			label: 'Outcomes',
			value: 'Scalar, Invalid',
		})
		expect(fields.find(field => field.label === 'Ticks')).toEqual({
			kind: 'text',
			label: 'Ticks',
			value: '100',
		})
		expect(fields.find(field => field.label === 'Display Range')).toEqual({
			kind: 'text',
			label: 'Display Range',
			value: '1 to 10 USD',
		})
		expect(fields.find(field => field.label === 'Answer Unit')).toEqual({
			kind: 'text',
			label: 'Answer Unit',
			value: 'USD',
		})
	})

	void test('preserves existing invalid outcomes without duplicating them', () => {
		const fields = getQuestionSummaryFields({
			...questionBase,
			marketType: 'categorical',
			outcomeLabels: ['Above', 'Invalid', 'Below'],
		})

		expect(fields.find(field => field.label === 'Outcomes')).toEqual({
			kind: 'text',
			label: 'Outcomes',
			value: 'Above, Invalid, Below',
		})
	})
})
