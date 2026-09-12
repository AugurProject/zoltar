import { expect, test } from 'bun:test'
import { assertCompatibleProfileProcessMode, chainSpecificPath } from '../../src/config/profiles.ts'

test('network paths preserve directories and extensions and replace existing network suffixes', () => {
	for (const { path, expected } of [
		{ path: '/state/history.json', expected: '/state/history.sepolia.json' },
		{ path: '/state/history', expected: '/state/history.sepolia' },
		{ path: '/state/history.mainnet.json', expected: '/state/history.sepolia.json' },
		{ path: '/state/history.sepolia.json', expected: '/state/history.sepolia.json' },
		{ path: '/state.mainnet/history.json', expected: '/state.mainnet/history.sepolia.json' },
	])
		expect(chainSpecificPath(path, 'sepolia')).toBe(expected)
	expect(chainSpecificPath('/state/history.sepolia.json', 'mainnet')).toBe('/state/history.mainnet.json')
})

test('profile switching requires matching process mode and dashboard binding', () => {
	const runtime = { once: false, ui: true, uiHost: '127.0.0.1', uiPort: 4153 }
	expect(() => assertCompatibleProfileProcessMode({ runtime }, { runtime: { ...runtime } })).not.toThrow()
	for (const change of [{ once: true }, { ui: false }, { uiHost: 'localhost' }, { uiPort: 4154 }]) {
		expect(() => assertCompatibleProfileProcessMode({ runtime }, { runtime: { ...runtime, ...change } })).toThrow('Chain profiles must use the same once mode and dashboard binding to switch in place')
	}
})
