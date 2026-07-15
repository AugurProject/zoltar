import { expect, test } from 'bun:test'
import { connectToExistingAnvilNode, getAnvilConnectionMode, getGasCostsAnvilConnectionMode, getIsolatedAnvilArgs } from '../testSupport/simulator/anvilNode'

test('getAnvilConnectionMode uses the platform default when ANVIL_RPC is not set', () => {
	const originalAnvilRpc = process.env['ANVIL_RPC']

	try {
		delete process.env['ANVIL_RPC']
		if (process.platform === 'win32') {
			expect(getAnvilConnectionMode()).toEqual({
				type: 'use-existing',
				rpcUrl: 'http://127.0.0.1:8545',
			})
		} else {
			expect(getAnvilConnectionMode()).toEqual({
				type: 'spawn-isolated',
				rpcUrl: '',
				port: 0,
			})
		}
	} finally {
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

test('isolated Anvil nodes disable persisted state snapshots', () => {
	const expectedBaseArgs = ['--host', '127.0.0.1', '--port', '12345', '--chain-id', '1', '--timestamp', '1', '--block-base-fee-per-gas', '0', '--gas-price', '0', '--no-priority-fee', '--max-persisted-states', '0']

	expect(getIsolatedAnvilArgs({ port: 12345 })).toEqual(expectedBaseArgs)
	expect(getIsolatedAnvilArgs({ port: 12345, printTraces: true })).toEqual([...expectedBaseArgs, '--print-traces'])
})

test('connectToExistingAnvilNode reports an actionable setup message when RPC validation fails', async () => {
	await expect(connectToExistingAnvilNode('https://127.0.0.1:8545', 'gas-costs')).rejects.toThrow('Unable to connect to Anvil at https://127.0.0.1:8545 for gas-costs. Start Anvil or set ANVIL_RPC to a local endpoint.')
})
