import { expect, test } from 'bun:test'
import { chainSpecificPath, assertCompatibleProfileProcessMode } from '../../src/config/profiles.ts'
import { renameAndSyncDirectory } from '../../src/config/durable-replacement.ts'

test('chain paths replace only a terminal chain suffix before the extension', () => {
	expect(chainSpecificPath('/state/history.json', 'sepolia')).toBe('/state/history.sepolia.json')
	expect(chainSpecificPath('/state/history.mainnet.json', 'sepolia')).toBe('/state/history.sepolia.json')
	expect(chainSpecificPath('/mainnet/history', 'mainnet')).toBe('/mainnet/history.mainnet')
	expect(chainSpecificPath('/state/a.mainnet.backup.json', 'sepolia')).toBe('/state/a.mainnet.backup.sepolia.json')
})

test('profile process mode checks every binding field but not execution settings', () => {
	const current = { runtime: { once: false, ui: true, uiHost: '127.0.0.1', uiPort: 42, execute: false } }
	const target = { runtime: { ...current.runtime, execute: true } }
	assertCompatibleProfileProcessMode(current, target)
	for (const runtime of [
		{ ...current.runtime, once: true },
		{ ...current.runtime, ui: false },
		{ ...current.runtime, uiHost: '0.0.0.0' },
		{ ...current.runtime, uiPort: 43 },
	]) {
		expect(() => assertCompatibleProfileProcessMode(current, { runtime })).toThrow('Chain profiles must use the same once mode and dashboard binding to switch in place')
	}
})

for (const failure of ['none', 'rename', 'open', 'sync', 'close']) {
	test(`durable rename preserves ${failure} failure and directory handle cleanup`, async () => {
		const events: string[] = []
		const operation = async (name: string) => {
			events.push(name)
			if (failure === name) throw new Error(name)
		}
		const result = renameAndSyncDirectory('/state/temp', '/state/config', {
			rename: async (from, to) => {
				expect([from, to]).toEqual(['/state/temp', '/state/config'])
				await operation('rename')
			},
			open: async (path, flags) => {
				expect([path, flags]).toEqual(['/state', 'r'])
				await operation('open')
				return { sync: () => operation('sync'), close: () => operation('close') }
			},
		})
		if (failure === 'none') await result
		else await expect(result).rejects.toThrow(failure)
		expect(events).toEqual(failure === 'rename' ? ['rename'] : failure === 'open' ? ['rename', 'open'] : ['rename', 'open', 'sync', 'close'])
	})
}
