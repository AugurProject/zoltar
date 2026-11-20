import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { createUniverseExplorer } from '../src/dashboard/universe-explorer.ts'
import type { UniverseNode } from '../src/dashboard/universe-tree.ts'

async function withExplorer(run: (host: HTMLElement) => Promise<void>) {
	const window = new Window({ width: 1440, height: 900 })
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
	Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document })
	try {
		const host = document.createElement('div')
		document.body.append(host)
		await run(host)
	} finally {
		if (previous === undefined) Reflect.deleteProperty(globalThis, 'document')
		else Object.defineProperty(globalThis, 'document', previous)
		await window.happyDOM.close()
	}
}
const flush = async () => await new Promise(resolve => setTimeout(resolve, 0))

test('#1480: looks up an explicit universe lineage without enumerating siblings or granting approval', async () => {
	await withExplorer(async host => {
		const lookups: string[] = []
		const approvals: Set<string>[] = []
		const explorer = createUniverseExplorer(host, {
			savedMessage: '',
			onChange: next => {
				approvals.push(next)
			},
			lookupUniverse: async id => {
				lookups.push(id)
				return [{ id: '0' }, { id, parentId: '0', outcomeIndex: '7' }]
			},
		})
		const snapshot = { universes: [{ id: '0' }], approved: new Set<string>(), network: 'mainnet', disabled: false }
		explorer.update(snapshot)
		const input = host.querySelector<HTMLInputElement>('[aria-label="Universe ID to look up"]')
		if (input === null) throw new Error('Universe lookup input is missing')
		input.value = '123'
		host.querySelector<HTMLButtonElement>('[data-universe-lookup]')?.click()
		await flush()
		expect(lookups).toEqual(['123'])
		expect(host.querySelector('[data-universe-focus="inspect:123"]')).not.toBeNull()
		expect(approvals).toEqual([])
		explorer.update({ ...snapshot, approved: new Set(['0']) })
		expect(host.querySelector('[data-universe-focus="inspect:123"]')).not.toBeNull()
		explorer.update({ ...snapshot, network: 'sepolia' })
		expect(host.querySelector('[data-universe-focus="inspect:123"]')).toBeNull()
	})
})

test('universe lookup ignores stale network responses and presents failures without granting approval', async () => {
	await withExplorer(async host => {
		let resolveLookup: ((nodes: readonly UniverseNode[]) => void) | undefined
		let fail = false
		const explorer = createUniverseExplorer(host, {
			savedMessage: '',
			onChange: () => {
				throw new Error('Lookup must not approve')
			},
			lookupUniverse: async () => {
				if (fail) throw new Error('RPC unavailable')
				return new Promise(resolve => {
					resolveLookup = resolve
				})
			},
		})
		const snapshot = { universes: [{ id: '0' }], approved: new Set<string>(), network: 'mainnet', disabled: false }
		explorer.update(snapshot)
		const input = host.querySelector<HTMLInputElement>('[aria-label="Universe ID to look up"]')
		const button = host.querySelector<HTMLButtonElement>('[data-universe-lookup]')
		if (input === null || button === null) throw new Error('Missing lookup controls')
		input.value = '123'
		button.click()
		expect(button.disabled).toBeTrue()
		explorer.update({ ...snapshot, network: 'sepolia' })
		if (resolveLookup === undefined) throw new Error('Lookup was not started')
		resolveLookup([{ id: '0' }, { id: '123', parentId: '0' }])
		await flush()
		expect(host.querySelector('[data-universe-focus="inspect:123"]')).toBeNull()
		fail = true
		input.value = '456'
		button.click()
		await flush()
		expect(host.querySelector('[role="status"]')?.textContent).toBe('RPC unavailable')
		expect(button.disabled).toBeFalse()
	})
})

test('lookup validation and pending feedback are associated with the input before the lineage browser', async () => {
	await withExplorer(async host => {
		const explorer = createUniverseExplorer(host, { savedMessage: '', onChange: () => {}, lookupUniverse: async () => new Promise(() => {}) })
		explorer.update({ universes: [{ id: '0' }], approved: new Set(), network: 'mainnet', disabled: false })
		const input = host.querySelector<HTMLInputElement>('[aria-label="Universe ID to look up"]')
		const button = host.querySelector<HTMLButtonElement>('[data-universe-lookup]')
		if (input === null || button === null) throw new Error('Missing lookup controls')
		input.value = 'abc'
		button.click()
		const description = input.getAttribute('aria-describedby')
		expect(description).toBeTruthy()
		const status = host.querySelector(`#${description}`)
		expect(status?.closest('label')).toBe(input.closest('label'))
		expect(status?.textContent).toContain('non-negative universe ID')
		input.value = '42'
		button.click()
		expect(status?.textContent).toContain('Looking up')
		expect(button.textContent).toBe('Looking up…')
	})
})
