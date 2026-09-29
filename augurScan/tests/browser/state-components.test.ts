import { expect, test } from 'bun:test'
import { createStateComponents } from '../../browser/state-components.ts'
import { overrideGlobals } from '../support/global-overrides.ts'

test('checkpoints without numeric series render unavailable instead of empty plots or zeroes', () => {
	const renderedText: string[] = []
	const restoreGlobals = overrideGlobals({
		document: {
			createElement: () => ({ append() {} }),
			createTextNode: (value: string) => value,
		},
	})
	try {
		const { chartCard } = createStateComponents(
			(tag, _className, text) => {
				if (text !== undefined) renderedText.push(text)
				return document.createElement(tag)
			},
			() => document.createElement('a'),
		)
		chartCard(
			'Fees',
			[
				{ timestamp: '1750000000', fee: null },
				{ timestamp: '1750000001', fee: undefined },
			],
			[{ key: 'fee', label: 'Fees' }],
			'Fee history',
		)
		expect(renderedText).toContain('Chart values are unavailable in these checkpoints.')
		expect(renderedText.some(text => text.includes('exact latest values'))).toBe(false)
	} finally {
		restoreGlobals()
	}
})
