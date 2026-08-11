import { describe, expect, test } from 'bun:test'
import { subscribeToWalletContextChanges } from '../protocol/injected.ts'

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
})
