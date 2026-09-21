/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { readWithRpcStateRetries } from '../lib/rpcStateRetries.js'

void describe('readWithRpcStateRetries', () => {
	void test('returns the first ready value without waiting', async () => {
		const waits: number[] = []
		const value = await readWithRpcStateRetries(
			async () => 'ready',
			value => value === 'ready',
			async milliseconds => {
				waits.push(milliseconds)
			},
		)
		expect(value).toBe('ready')
		expect(waits).toEqual([])
	})

	void test('follows the retry schedule and returns the last value when state never settles', async () => {
		const waits: number[] = []
		let reads = 0
		const value = await readWithRpcStateRetries(
			async () => {
				reads += 1
				return reads
			},
			value => value >= 3,
			async milliseconds => {
				waits.push(milliseconds)
			},
		)
		expect(value).toBe(3)
		expect(waits).toEqual([250, 500])

		const exhausted = await readWithRpcStateRetries(
			async () => 'pending',
			() => false,
			async () => undefined,
		)
		expect(exhausted).toBe('pending')
	})
})
