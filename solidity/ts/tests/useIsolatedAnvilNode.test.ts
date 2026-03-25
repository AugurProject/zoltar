import { expect, test } from 'bun:test'
import { getAnvilConnectionMode } from '../testsuite/simulator/useIsolatedAnvilNode'

test('getAnvilConnectionMode uses existing localhost Anvil on Windows', () => {
	if (process.platform !== 'win32') return

	expect(getAnvilConnectionMode()).toEqual({
		type: 'use-existing',
		rpcUrl: process.env['ANVIL_RPC'] ?? 'http://127.0.0.1:8545',
	})
})

test('getAnvilConnectionMode spawns isolated Anvil outside Windows', () => {
	if (process.platform === 'win32') return

	expect(getAnvilConnectionMode()).toEqual({
		type: 'spawn-isolated',
		rpcUrl: '',
		port: 0,
	})
})
