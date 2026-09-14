export type DevToolsCommand = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown>
export type DevToolsSocket = EventTarget & { send(data: string): void }
export type DevToolsProcess = { isExited(): boolean; onExit(listener: (description: string) => void): void }

export function createDevToolsCommandSender(socket: DevToolsSocket, browser: DevToolsProcess, timeoutMilliseconds = 15_000): DevToolsCommand {
	let requestId = 0
	const pending = new Map<number, { reject: (error: Error) => void; resolve: (value: unknown) => void }>()
	const rejectPending = (message: string) => {
		for (const request of pending.values()) request.reject(new Error(message))
		pending.clear()
	}

	socket.addEventListener('message', event => {
		if (!(event instanceof MessageEvent) || typeof event.data !== 'string') return
		const message: unknown = JSON.parse(event.data)
		if (typeof message !== 'object' || message === null || !('id' in message) || typeof message.id !== 'number') return
		const request = pending.get(message.id)
		if (request === undefined) return
		pending.delete(message.id)
		if ('error' in message) request.reject(new Error(`Chromium DevTools command failed: ${JSON.stringify(message.error)}`))
		else request.resolve('result' in message ? message.result : undefined)
	})
	socket.addEventListener('close', () => rejectPending('Chromium DevTools connection closed while commands were pending'))
	socket.addEventListener('error', () => rejectPending('Chromium DevTools connection failed while commands were pending'))
	browser.onExit(description => rejectPending(`Chromium exited with ${description} while commands were pending`))

	return async (method, params = {}, sessionId) => {
		if (browser.isExited()) throw new Error(`Chromium already exited before DevTools command ${method}`)
		requestId += 1
		const id = requestId
		return await new Promise<unknown>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				pending.delete(id)
				reject(new Error(`Chromium DevTools command ${method} did not complete within ${timeoutMilliseconds.toString()}ms`))
			}, timeoutMilliseconds)
			pending.set(id, {
				reject: error => {
					clearTimeout(timeoutId)
					reject(error)
				},
				resolve: value => {
					clearTimeout(timeoutId)
					resolve(value)
				},
			})
			try {
				socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }))
			} catch (error) {
				pending.get(id)?.reject(error instanceof Error ? error : new Error(String(error)))
				pending.delete(id)
			}
		})
	}
}
