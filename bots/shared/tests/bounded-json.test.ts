import { describe, expect, test } from 'bun:test'
import { boundedJsonResponse } from '../src/infrastructure/bounded-json.ts'

describe('bounded JSON response lifecycle', () => {
	test.each([
		['9', 'Test response exceeds 8 bytes'],
		['invalid', 'invalid Content-Length'],
		['9007199254740992', 'outside the supported range'],
	])('cancels and unlocks a response rejected by its length header %s', async (length, message) => {
		let cancellations = 0
		const body = new ReadableStream<Uint8Array>({
			cancel() {
				cancellations += 1
			},
		})
		const response = new Response(body, { headers: { 'content-length': length } })
		await expect(boundedJsonResponse(response, 8, 'Test')).rejects.toThrow(message)
		expect(cancellations).toBe(1)
		expect(body.locked).toBe(false)
	})

	test('cancels and unlocks a response that exceeds the limit while reading', async () => {
		let cancellations = 0
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"ok":true}'))
			},
			cancel() {
				cancellations += 1
			},
		})
		await expect(boundedJsonResponse(new Response(body), 8, 'Test')).rejects.toThrow('Test response exceeds 8 bytes')
		expect(cancellations).toBe(1)
		expect(body.locked).toBe(false)
	})

	test('preserves the validation error if cancellation fails', async () => {
		const body = new ReadableStream<Uint8Array>({
			cancel() {
				throw new Error('Cleanup failed')
			},
		})
		await expect(boundedJsonResponse(new Response(body, { headers: { 'content-length': '9' } }), 8, 'Test')).rejects.toThrow('Test response exceeds 8 bytes')
		expect(body.locked).toBe(false)
	})

	test('accepts JSON at the byte limit and releases the reader', async () => {
		const response = new Response('{"ok":true}')
		expect(await boundedJsonResponse(response, 11, 'Test')).toEqual({ ok: true })
		expect(response.body?.locked).toBe(false)
	})

	test('releases the reader when parsing fails', async () => {
		const response = new Response('invalid')
		await expect(boundedJsonResponse(response, 8, 'Test')).rejects.toBeInstanceOf(SyntaxError)
		expect(response.body?.locked).toBe(false)
	})

	test('releases the reader when the source stream fails', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new Error('Source failed'))
			},
		})
		await expect(boundedJsonResponse(new Response(body), 8, 'Test')).rejects.toThrow('Source failed')
		expect(body.locked).toBe(false)
	})
})
