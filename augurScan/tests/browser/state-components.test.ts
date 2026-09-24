import { expect, test } from 'bun:test'
import { createStateComponents } from '../../browser/state-components.ts'

test('checkpoints without numeric series render unavailable instead of empty plots or zeroes', () => {
	const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
	const renderedText: string[] = []
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: {
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
		if (originalDocument === undefined) Reflect.deleteProperty(globalThis, 'document')
		else Object.defineProperty(globalThis, 'document', originalDocument)
	}
})
