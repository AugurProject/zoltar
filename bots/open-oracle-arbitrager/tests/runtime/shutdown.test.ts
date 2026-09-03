import { expect, test } from 'bun:test'
import { createArbitragerShutdownController } from '../../src/runtime/shutdown.ts'

test('shutdown request interrupts a long polling wait and remains idempotent', async () => {
	using shutdown = createArbitragerShutdownController()
	const startedAt = Date.now()
	const waiting = shutdown.wait(60_000)
	shutdown.requestShutdown()
	shutdown.requestShutdown()
	await expect(Promise.race([waiting.then(() => 'stopped'), Bun.sleep(250).then(() => 'timed-out')])).resolves.toBe('stopped')
	expect(Date.now() - startedAt).toBeLessThan(1_000)
	expect(shutdown.isRequested()).toBe(true)
})
