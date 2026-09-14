import { expect, test } from 'bun:test'
import { batch, effect, signal } from '@preact/signals'
import { signalValues } from '../lib/signalValues.js'

test('a consumer subscribes only to the state it reads across a hook boundary', () => {
	const balance = signal(1n)
	const clock = signal(10n)
	const observed: bigint[] = []
	const dispose = effect(() => {
		const state = Object.assign(signalValues({ balance, clock }), { refresh: () => {} })
		observed.push(state.balance)
	})
	try {
		clock.value = 11n
		expect(observed).toEqual([1n])
		batch(() => {
			balance.value = 2n
			balance.value = 3n
			clock.value = 12n
		})
		expect(observed).toEqual([1n, 3n])
	} finally {
		dispose()
	}
})
