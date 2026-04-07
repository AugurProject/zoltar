import { expect, test } from 'bun:test'
import { getAnvilConnectionMode } from '../testsuite/simulator/useIsolatedAnvilNode'

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
