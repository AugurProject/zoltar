/// <reference types='bun-types' />

import { expect, mock, test } from 'bun:test'
import { normalizeAccount } from '../../wallet/chainBackend.js'
import { createSimulationProvider } from '../../simulation/simulationProvider.js'
import { SIMULATION_WRONG_CHAIN_ID_HEX, UNRECOGNIZED_CHAIN_ERROR_CODE, parseSimulationWalletMode } from '../../simulation/simulationWallet.js'

test('simulation providers use the latest block for EIP-1898 calls unsupported by TEVM', async () => {
	const account = normalizeAccount('0x00000000000000000000000000000000000000a1')
	if (account === undefined) throw new Error('Expected a valid simulation account')
	const requestRpc = mock(async () => '0x')
	const provider = createSimulationProvider({
		getChainId: () => '0x1',
		getSelectedAccount: () => account,
		requestRpc,
	})

	await provider.request({
		method: 'eth_call',
		params: [
			{ data: '0x', to: account },
			{ blockHash: `0x${'01'.repeat(32)}`, requireCanonical: true },
		],
	})

	expect(requestRpc).toHaveBeenCalledWith({
		method: 'eth_call',
		params: [{ data: '0x', to: account }, 'latest'],
	})
})

function createProviderHarness(initialWalletMode?: 'connected' | 'disconnected' | 'wrong-chain') {
	const account = normalizeAccount('0x00000000000000000000000000000000000000a1')
	if (account === undefined) throw new Error('Expected a valid simulation account')
	const requestRpc = mock(async () => '0x')
	const modeChanges: string[] = []
	const events: { name: string; args: unknown[] }[] = []
	const provider = createSimulationProvider({
		getChainId: () => '0x539',
		getSelectedAccount: () => account,
		...(initialWalletMode === undefined ? {} : { initialWalletMode }),
		onWalletModeChange: (mode, previousMode) => {
			modeChanges.push(`${previousMode}->${mode}`)
		},
		requestRpc,
	})
	for (const name of ['accountsChanged', 'chainChanged']) provider.on?.(name, (...args) => events.push({ name, args }))
	return { account, events, modeChanges, provider, requestRpc }
}

test('simulation providers default to a connected wallet on the simulation chain', async () => {
	const { account, events, provider, requestRpc } = createProviderHarness()

	expect(provider.getWalletMode()).toBe('connected')
	await expect(provider.request({ method: 'eth_accounts' })).resolves.toEqual([account])
	await expect(provider.request({ method: 'eth_requestAccounts' })).resolves.toEqual([account])
	await expect(provider.request({ method: 'eth_chainId' })).resolves.toBe('0x539')
	await expect(provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x539' }] })).resolves.toBeNull()
	expect(events).toEqual([])
	expect(requestRpc).not.toHaveBeenCalled()
})

test('simulation providers report a foreign chain in wrong-chain mode and switch back on request', async () => {
	const { account, events, modeChanges, provider } = createProviderHarness('wrong-chain')

	await expect(provider.request({ method: 'eth_chainId' })).resolves.toBe(SIMULATION_WRONG_CHAIN_ID_HEX)
	await expect(provider.request({ method: 'eth_accounts' })).resolves.toEqual([account])

	await expect(provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x539' }] })).resolves.toBeNull()
	expect(provider.getWalletMode()).toBe('connected')
	await expect(provider.request({ method: 'eth_chainId' })).resolves.toBe('0x539')
	expect(events).toEqual([{ name: 'chainChanged', args: ['0x539'] }])
	expect(modeChanges).toEqual(['wrong-chain->connected'])
})

test('simulation providers reject switching to a chain the simulated wallet does not know', async () => {
	const { events, provider } = createProviderHarness('wrong-chain')

	const rejection = provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] })
	await expect(rejection).rejects.toMatchObject({ code: UNRECOGNIZED_CHAIN_ERROR_CODE })
	await expect(provider.request({ method: 'wallet_switchEthereumChain', params: [] })).rejects.toMatchObject({ code: -32602 })
	expect(provider.getWalletMode()).toBe('wrong-chain')
	expect(events).toEqual([])
})

test('simulation providers expose no accounts in disconnected mode until the connection is requested', async () => {
	const { account, events, modeChanges, provider } = createProviderHarness('disconnected')

	await expect(provider.request({ method: 'eth_accounts' })).resolves.toEqual([])
	await expect(provider.request({ method: 'eth_chainId' })).resolves.toBe('0x539')
	expect(events).toEqual([])

	await expect(provider.request({ method: 'eth_requestAccounts' })).resolves.toEqual([account])
	expect(provider.getWalletMode()).toBe('connected')
	await expect(provider.request({ method: 'eth_accounts' })).resolves.toEqual([account])
	expect(events).toEqual([{ name: 'accountsChanged', args: [[account]] }])
	expect(modeChanges).toEqual(['disconnected->connected'])
})

test('simulation providers emit wallet events when QA controls change the mode', async () => {
	const { account, events, provider } = createProviderHarness()
	const removed = mock(() => undefined)
	provider.on?.('chainChanged', removed)
	provider.removeListener?.('chainChanged', removed)

	provider.setWalletMode('wrong-chain')
	provider.setWalletMode('wrong-chain')
	provider.setWalletMode('disconnected')
	provider.setWalletMode('connected')

	expect(removed).not.toHaveBeenCalled()
	expect(events).toEqual([
		{ name: 'chainChanged', args: [SIMULATION_WRONG_CHAIN_ID_HEX] },
		{ name: 'chainChanged', args: ['0x539'] },
		{ name: 'accountsChanged', args: [[]] },
		{ name: 'accountsChanged', args: [[account]] },
	])
})

test('simulation wallet modes parse from the URL with a connected default', () => {
	expect(parseSimulationWalletMode(undefined)).toBe('connected')
	expect(parseSimulationWalletMode(null)).toBe('connected')
	expect(parseSimulationWalletMode('')).toBe('connected')
	expect(parseSimulationWalletMode('connected')).toBe('connected')
	expect(parseSimulationWalletMode(' Wrong-Chain ')).toBe('wrong-chain')
	expect(parseSimulationWalletMode('disconnected')).toBe('disconnected')
	expect(parseSimulationWalletMode('locked')).toBe('connected')
})
