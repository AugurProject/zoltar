import { expect, test } from 'bun:test'
import { renderExplorerPage } from '../../browser/explorer-page.ts'
import { overrideGlobals } from '../support/global-overrides.ts'

test('an earlier failed explorer request cannot replace a newer route', async () => {
	let children: unknown[] = []
	const content = {
		replaceChildren(...nodes: unknown[]) {
			children = nodes
		},
	}
	const currentLocation = { origin: 'https://scanner.test', href: 'https://scanner.test/tx/first?chainId=1' }
	const restoreGlobals = overrideGlobals({
		document: {
			querySelector: () => content,
			createElement: () => ({ className: '', textContent: '' }),
		},
		location: currentLocation,
	})
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
		restoreGlobals()
	}
})

test('a failed evidence request can retry on the same route', async () => {
	let children: Array<{ className?: string; textContent?: string; listeners?: Map<string, () => void> }> = []
	const createNode = () => {
		const listeners = new Map<string, () => void>()
		return {
			className: '',
			textContent: '',
			listeners,
			append() {},
			addEventListener(type: string, listener: () => void) {
				listeners.set(type, listener)
			},
		}
	}
	const content = {
		replaceChildren(...nodes: typeof children) {
			children = nodes
		},
		removeAttribute() {},
	}
	const restoreGlobals = overrideGlobals({
		document: { querySelector: () => content, createElement: createNode },
		location: { origin: 'https://scanner.test', href: 'https://scanner.test/tx/first?chainId=1' },
	})
	try {
		let attempts = 0
		const load = () =>
			renderExplorerPage('/tx/first', '1', async () => {
				attempts++
				if (attempts === 1) throw new Error('Temporary failure')
				return { transaction: { hash: '0x123', block_number: '1', block_timestamp: '2026-09-23T00:00:00Z', explorer_base_url: 'https://etherscan.io' }, logs: [] }
			})
		await load()
		const retry = children.find(child => child.textContent === 'Retry')
		expect(retry).toBeDefined()
		retry?.listeners?.get('click')?.()
		await Bun.sleep(0)
		expect(attempts).toBe(2)
		expect(children[0]?.className).toBe('section-heading')
	} finally {
		restoreGlobals()
	}
})
