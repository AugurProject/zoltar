import { describe, expect, test } from 'bun:test'
import { createWalletContextSubscription, subscribeToWalletContextChanges } from '../injectedEthereum.js'

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
