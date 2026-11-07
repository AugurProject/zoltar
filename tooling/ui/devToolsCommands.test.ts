import { expect, mock, test } from 'bun:test'
import { createDevToolsCommandSender } from './devToolsCommands.mts'

function fixture(timeoutMilliseconds = 1_000) {
	const send = mock((_data: string) => undefined)
	const socket = Object.assign(new EventTarget(), { send })
	let exited = false
	let exitListener: ((description: string) => void) | undefined
	const command = createDevToolsCommandSender(
		socket,
		{
			isExited: () => exited,
			onExit: listener => {
				exitListener = listener
			},
		},
		timeoutMilliseconds,
	)
	return {
		command,
		send,
		socket,
		reply: (response: unknown) => socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(response) })),
		exit: () => {
			exited = true
			exitListener?.('code 1')
		},
	}
}

test('matches out-of-order responses to requests and forwards session identifiers', async () => {
	const { command, reply, send } = fixture()
	const first = command('Page.enable')
	const second = command('Runtime.evaluate', { expression: '1 + 2' }, 'page-session')
	expect(send.mock.calls.map(([data]) => JSON.parse(data))).toEqual([
		{ id: 1, method: 'Page.enable', params: {} },
		{ id: 2, method: 'Runtime.evaluate', params: { expression: '1 + 2' }, sessionId: 'page-session' },
	])
	reply({ method: 'Page.loadEventFired' })
	reply({ id: 99, result: 'unrelated' })
	reply({ id: 2, result: { value: 3 } })
	reply({ id: 1 })
	expect(await second).toEqual({ value: 3 })
	expect(await first).toBeUndefined()
})

test.each(['close', 'error'])('rejects every pending request when the socket emits %s', async eventName => {
	const { command, socket } = fixture()
	const first = command('Page.enable')
	const second = command('Runtime.enable')
	const rejected = Promise.allSettled([first, second])
	socket.dispatchEvent(new Event(eventName))
	for (const result of await rejected) expect(result).toMatchObject({ status: 'rejected', reason: { message: expect.stringContaining('Chromium DevTools connection') } })
})

test.each([
	['close', 'closed'],
	['error', 'failed'],
])('rejects future requests after the socket emits %s with no pending commands', async (eventName, description) => {
	const { command, reply, send, socket } = fixture(5)
	const completed = command('Page.enable')
	reply({ id: 1, result: {} })
	await completed
	socket.dispatchEvent(new Event(eventName))
	await expect(command('Runtime.evaluate')).rejects.toThrow(`Chromium DevTools connection ${description}`)
	expect(send).toHaveBeenCalledTimes(1)
})

test('stalled evaluations retain the caller and safe command context without exposing parameters', async () => {
	const { command, reply } = fixture(1)
	reply({ method: 'Page.frameStartedLoading', params: { frameId: 'private-frame-content' } })
	const evaluateLiquidationVault = () => command('Runtime.evaluate', { awaitPromise: false, expression: 'window.sign("private-wallet-value")' }, 'page-session')
	const outcome = await Promise.allSettled([evaluateLiquidationVault()])
	if (outcome[0]?.status !== 'rejected' || !(outcome[0].reason instanceof Error)) throw new Error('Expected a stalled evaluation error')
	expect(outcome[0].reason.message).toContain('request 1, session page-session, awaitPromise false')
	expect(outcome[0].reason.stack).toContain('devToolsCommands.test.ts:')
	expect(outcome[0].reason.message).toContain('Page.frameStartedLoading')
	expect(outcome[0].reason.message).not.toContain('private-wallet-value')
	expect(outcome[0].reason.message).not.toContain('private-frame-content')
})

test('rejects pending and future requests after the browser exits', async () => {
	const { command, exit, send } = fixture()
	const pending = command('Page.enable')
	exit()
	await expect(pending).rejects.toThrow('Chromium exited with code 1')
	await expect(command('Runtime.enable')).rejects.toThrow('Chromium already exited')
	expect(send).toHaveBeenCalledTimes(1)
})

test('reports protocol errors without affecting another request', async () => {
	const { command, reply } = fixture()
	const failed = command('Invalid.command')
	const succeeded = command('Page.enable')
	reply({ id: 1, error: { message: 'Method not found' } })
	reply({ id: 2, result: {} })
	await expect(failed).rejects.toThrow('Method not found')
	expect(await succeeded).toEqual({})
})

test('times out a silent command and ignores its late response', async () => {
	const { command, reply } = fixture(1)
	await expect(command('Page.enable')).rejects.toThrow('did not complete within 1ms')
	reply({ id: 1, result: {} })
	const next = command('Runtime.enable')
	reply({ id: 2, result: {} })
	expect(await next).toEqual({})
})

test('rejects synchronous send failures without leaving a pending timeout', async () => {
	const { command, send } = fixture()
	send.mockImplementation(() => {
		throw new Error('Socket disconnected')
	})
	await expect(command('Page.enable')).rejects.toThrow('Socket disconnected')
})
