import { expect, test } from 'bun:test'
import { connectToExistingAnvilNode, getAnvilConnectionMode, getGasCostsAnvilConnectionMode, getIsolatedAnvilArgs, parseAnvilListeningRpcUrl, resolveAnvilBinary } from '../testSupport/simulator/anvilNode'

test('getAnvilConnectionMode spawns an isolated node on Windows when ANVIL_RPC is not set', () => {
	const originalAnvilRpc = process.env['ANVIL_RPC']
	const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')

	try {
		delete process.env['ANVIL_RPC']
		Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
		expect(getAnvilConnectionMode()).toEqual({
			type: 'spawn-isolated',
			rpcUrl: '',
			port: 0,
		})
	} finally {
		if (originalPlatformDescriptor !== undefined) Object.defineProperty(process, 'platform', originalPlatformDescriptor)
		if (originalAnvilRpc === undefined) {
			delete process.env['ANVIL_RPC']
		} else {
			process.env['ANVIL_RPC'] = originalAnvilRpc
		}
	}
})

test('getAnvilConnectionMode uses ANVIL_RPC when provided', () => {
	const originalAnvilRpc = process.env['ANVIL_RPC']

	try {
		process.env['ANVIL_RPC'] = 'http://127.0.0.1:8545'
		expect(getAnvilConnectionMode()).toEqual({
			type: 'use-existing',
			rpcUrl: 'http://127.0.0.1:8545',
		})
	} finally {
		if (originalAnvilRpc === undefined) {
			delete process.env['ANVIL_RPC']
		} else {
			process.env['ANVIL_RPC'] = originalAnvilRpc
		}
	}
})

test('getGasCostsAnvilConnectionMode spawns an isolated node when ANVIL_RPC is not set', () => {
	const originalAnvilRpc = process.env['ANVIL_RPC']

	try {
		delete process.env['ANVIL_RPC']
		expect(getGasCostsAnvilConnectionMode()).toEqual({
			type: 'spawn-isolated',
			rpcUrl: '',
			port: 0,
		})
	} finally {
		if (originalAnvilRpc === undefined) {
			delete process.env['ANVIL_RPC']
		} else {
			process.env['ANVIL_RPC'] = originalAnvilRpc
		}
	}
})

test('getGasCostsAnvilConnectionMode uses ANVIL_RPC when provided', () => {
	const originalAnvilRpc = process.env['ANVIL_RPC']

	try {
		process.env['ANVIL_RPC'] = 'http://127.0.0.1:8545'
		expect(getGasCostsAnvilConnectionMode()).toEqual({
			type: 'use-existing',
			rpcUrl: 'http://127.0.0.1:8545',
		})
	} finally {
		if (originalAnvilRpc === undefined) {
			delete process.env['ANVIL_RPC']
		} else {
			process.env['ANVIL_RPC'] = originalAnvilRpc
		}
	}
})

test('isolated Anvil nodes atomically select a port and limit their runtime threads', () => {
	const expectedBaseArgs = ['--host', '127.0.0.1', '--port', '0', '--threads', '1', '--chain-id', '1', '--timestamp', '1', '--block-base-fee-per-gas', '0', '--gas-price', '0', '--no-priority-fee', '--max-persisted-states', '0']

	expect(getIsolatedAnvilArgs()).toEqual(expectedBaseArgs)
	expect(getIsolatedAnvilArgs({ printTraces: true })).toEqual([...expectedBaseArgs, '--print-traces'])
})

test('isolated Anvil startup reads the OS-assigned listening port', () => {
	expect(parseAnvilListeningRpcUrl('Available Accounts\nListening on 127.0.0.1:43127\n')).toBe('http://127.0.0.1:43127')
	expect(parseAnvilListeningRpcUrl('Listening on 0.0.0.0:43128')).toBe('http://127.0.0.1:43128')
	expect(parseAnvilListeningRpcUrl('Listening on 127.0.0.1:')).toBeUndefined()
})

test('Anvil executable resolution supports standard and quoted Windows installations', () => {
	expect(resolveAnvilBinary({ environment: { USERPROFILE: 'C:\\Users\\tester' }, pathExists: path => path === 'C:\\Users\\tester\\.foundry\\bin\\anvil.exe', platform: 'win32', which: () => null })).toBe('C:\\Users\\tester\\.foundry\\bin\\anvil.exe')
	expect(resolveAnvilBinary({ environment: { ANVIL_BIN: '"C:\\Program Files\\Foundry\\anvil.exe"' }, pathExists: () => false, platform: 'win32', which: () => null })).toBe('C:\\Program Files\\Foundry\\anvil.exe')
})

test('Anvil executable resolution uses the absolute PATH match before a command-name fallback', () => {
	expect(resolveAnvilBinary({ environment: {}, pathExists: () => false, platform: 'win32', which: () => 'C:\\Foundry\\anvil.exe' })).toBe('C:\\Foundry\\anvil.exe')
	expect(resolveAnvilBinary({ environment: {}, pathExists: () => false, platform: 'win32', which: () => null })).toBe('anvil')
})

test('connectToExistingAnvilNode reports an actionable setup message when RPC validation fails', async () => {
	await expect(connectToExistingAnvilNode('https://127.0.0.1:8545', 'gas-costs')).rejects.toThrow('Unable to connect to Anvil at https://127.0.0.1:8545 for gas-costs. Start Anvil or set ANVIL_RPC to a local endpoint.')
})
