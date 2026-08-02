import { describe, expect, test } from 'bun:test'
import { createSettingsUpdateQueue } from '../../src/core/settings-update-queue.ts'

describe('settings update queue', () => {
	test('continues after a failed settings write', async () => {
		const queue = createSettingsUpdateQueue()
		await expect(queue(async () => Promise.reject(new Error('disk failure')))).rejects.toThrow('disk failure')
		await expect(queue(async () => 'paused')).resolves.toBe('paused')
	})
})
