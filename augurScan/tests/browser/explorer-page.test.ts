import { expect, test } from 'bun:test'
import { renderExplorerPage } from '../../browser/explorer-page.ts'

test('an earlier failed explorer request cannot replace a newer route', async () => {
	const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
	const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
	let children: unknown[] = []
	const content = {
		replaceChildren(...nodes: unknown[]) {
			children = nodes
		},
	}
	const currentLocation = { origin: 'https://scanner.test', href: 'https://scanner.test/tx/first?chainId=1' }
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: {
			querySelector: () => content,
			createElement: () => ({ className: '', textContent: '' }),
		},
	})
	Object.defineProperty(globalThis, 'location', { configurable: true, value: currentLocation })
	try {
		let rejectRequest: ((reason: Error) => void) | undefined
		const pending = new Promise<unknown>((_resolve, reject) => {
			rejectRequest = reject
		})
		const earlier = renderExplorerPage('/tx/first', '1', async () => pending)
		currentLocation.href = 'https://scanner.test/block/second?chainId=1'
		const newerEvidence = { textContent: 'Newer block evidence' }
		content.replaceChildren(newerEvidence)
		if (rejectRequest === undefined) throw new Error('The earlier request did not start')
		rejectRequest(new Error('Earlier request failed'))
		await earlier
		expect(children).toEqual([newerEvidence])
	} finally {
		if (originalDocument === undefined) Reflect.deleteProperty(globalThis, 'document')
		else Object.defineProperty(globalThis, 'document', originalDocument)
		if (originalLocation === undefined) Reflect.deleteProperty(globalThis, 'location')
		else Object.defineProperty(globalThis, 'location', originalLocation)
	}
})
