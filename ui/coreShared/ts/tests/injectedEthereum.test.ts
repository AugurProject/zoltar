import { describe, expect, test } from 'bun:test'
import { createWalletContextSubscription, formatChainIdHex, readInjectedChainIdNumber, requestInjectedAccount, subscribeToWalletContextChanges, switchInjectedChain, type InjectedEthereum } from '../wallet/injectedEthereum.js'

test('rejects a mainnet switch before requesting the wallet and permits Sepolia', async () => {
	const calls: unknown[] = []
	const provider: InjectedEthereum = {
		request: async parameters => {
			calls.push(parameters)
			return undefined
		},
	}
	await expect(switchInjectedChain(provider, '0x01')).rejects.toThrow('Ethereum mainnet is disabled.')
	expect(calls).toEqual([])
	await switchInjectedChain(provider, '0xaa36a7')
	expect(calls).toEqual([{ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] }])
	await switchInjectedChain(provider, 11155111)
	expect(calls.at(-1)).toEqual({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] })
	await expect(switchInjectedChain(provider, -1)).rejects.toThrow('Requested wallet chain ID is invalid')
	expect(formatChainIdHex(11155111)).toBe('0xaa36a7')
})

test('reads the wallet chain as a number and requests the account through eth_requestAccounts', async () => {
	const calls: unknown[] = []
	const provider: InjectedEthereum = {
		request: async parameters => {
			calls.push(parameters)
			if (parameters.method === 'eth_chainId') return '0xaa36a7'
			if (parameters.method === 'eth_requestAccounts') return ['0x0000000000000000000000000000000000000001']
			return undefined
		},
	}
	expect(await readInjectedChainIdNumber(provider)).toBe(11155111)
	expect(await requestInjectedAccount(provider)).toBe('0x0000000000000000000000000000000000000001')
	expect(calls).toEqual([
		{ method: 'eth_chainId', params: [] },
		{ method: 'eth_requestAccounts', params: [] },
	])
})

describe('injected wallet context events', () => {
	test('invalidates for account and chain changes, then removes both listeners', () => {
		const listeners = new Map<string, (...args: unknown[]) => void>()
		const eventSource = {
			on(eventName: string, handler: (...args: unknown[]) => void) {
				listeners.set(eventName, handler)
			},
			removeListener(eventName: string, handler: (...args: unknown[]) => void) {
				if (listeners.get(eventName) === handler) listeners.delete(eventName)
			},
		}
		const events: string[] = []
		const unsubscribe = subscribeToWalletContextChanges(eventSource, eventName => events.push(eventName))

		listeners.get('accountsChanged')?.(['0x0000000000000000000000000000000000000001'])
		listeners.get('chainChanged')?.('0x1')

		expect(events).toEqual(['accountsChanged', 'chainChanged'])
		unsubscribe()
		expect(listeners.size).toBe(0)
	})

	test('binds a provider that appears during connection and ignores only connection-time events', () => {
		const listeners = new Map<string, (...args: unknown[]) => void>()
		const eventSource = {
			on: (eventName: string, handler: (...args: unknown[]) => void) => listeners.set(eventName, handler),
			removeListener: (eventName: string, handler: (...args: unknown[]) => void) => {
				if (listeners.get(eventName) === handler) listeners.delete(eventName)
			},
		}
		let connectionPending = true
		const events: string[] = []
		const subscription = createWalletContextSubscription(eventName => {
			if (!connectionPending) events.push(eventName)
		})
		subscription.bind(undefined)
		subscription.bind(eventSource)
		listeners.get('chainChanged')?.('0xaa36a7')
		listeners.get('accountsChanged')?.(['0x0000000000000000000000000000000000000001'])
		connectionPending = false
		listeners.get('accountsChanged')?.([])

		expect(events).toEqual(['accountsChanged'])
		subscription.dispose()
		expect(listeners.size).toBe(0)
	})
})
