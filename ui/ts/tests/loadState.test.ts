/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { runLoadRequest } from '../lib/loadState.js'

void describe('load state helpers', () => {
	void test('runLoadRequest runs success handlers and clears loading', async () => {
		let loading = false
		let started = false
		let successValue: number | undefined

		await runLoadRequest({
			setLoading: value => {
				loading = value
			},
			onStart: () => {
				started = true
			},
			load: async () => 42,
			onSuccess: value => {
				successValue = value
			},
		})

		expect(started).toBe(true)
		expect(successValue).toBe(42)
		expect(loading).toBe(false)
	})

	void test('runLoadRequest skips stale results', async () => {
		let loading = false
		let current = true
		let successCalled = false

		await runLoadRequest({
			isCurrent: () => current,
			setLoading: value => {
				loading = value
			},
			load: async () => {
				current = false
				return 1
			},
			onSuccess: () => {
				successCalled = true
			},
		})

		expect(successCalled).toBe(false)
		expect(loading).toBe(true)
	})

	void test('runLoadRequest invokes error handlers and clears loading', async () => {
		let loading = false
		let errorMessage: string | undefined

		await runLoadRequest({
			setLoading: value => {
				loading = value
			},
			load: async () => {
				throw new Error('boom')
			},
			onSuccess: () => undefined,
			onError: error => {
				errorMessage = error instanceof Error ? error.message : 'unknown'
			},
		})

		expect(errorMessage).toBe('boom')
		expect(loading).toBe(false)
	})
})
