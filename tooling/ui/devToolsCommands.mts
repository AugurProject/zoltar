export type DevToolsCommand = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown>
export type DevToolsSocket = EventTarget & { readonly readyState?: number; send(data: string): void }
export type DevToolsProcess = { isExited(): boolean; onExit(listener: (description: string) => void): void; readDiagnostics?(): string }

const diagnosticEvents = new Set(['Inspector.detached', 'Inspector.targetCrashed', 'Page.frameNavigated', 'Page.frameStartedLoading', 'Page.frameStoppedLoading', 'Page.domContentEventFired', 'Page.loadEventFired', 'Runtime.executionContextCreated', 'Runtime.executionContextsCleared'])

export function createDevToolsCommandSender(socket: DevToolsSocket, browser: DevToolsProcess, timeoutMilliseconds = 15_000): DevToolsCommand {
	let requestId = 0
	let connectionFailure: string | undefined
	const recentEvents: string[] = []
	const pending = new Map<number, { reject: (error: Error) => void; resolve: (value: unknown) => void }>()
	const rejectPending = (message: string) => {
		connectionFailure ??= message
		for (const request of pending.values()) request.reject(new Error(`${connectionFailure} while commands were pending`))
		pending.clear()
	}

	socket.addEventListener('message', event => {
		if (!(event instanceof MessageEvent) || typeof event.data !== 'string') return
		const message: unknown = JSON.parse(event.data)
		if (typeof message !== 'object' || message === null) return
		if ('method' in message && typeof message.method === 'string' && diagnosticEvents.has(message.method)) {
			recentEvents.push(message.method)
			if (recentEvents.length > 8) recentEvents.shift()
		}
		if (!('id' in message) || typeof message.id !== 'number') return
		const request = pending.get(message.id)
		if (request === undefined) return
		pending.delete(message.id)
		if ('error' in message) request.reject(new Error(`Chromium DevTools command failed: ${JSON.stringify(message.error)}`))
		else request.resolve('result' in message ? message.result : undefined)
	})
	socket.addEventListener('close', () => rejectPending('Chromium DevTools connection closed'))
	socket.addEventListener('error', () => rejectPending('Chromium DevTools connection failed'))
	browser.onExit(description => rejectPending(`Chromium exited with ${description}`))

	return async (method, params = {}, sessionId) => {
		if (browser.isExited()) throw new Error(`Chromium already exited before DevTools command ${method}`)
		if (connectionFailure !== undefined) throw new Error(`${connectionFailure} before DevTools command ${method}`)
		requestId += 1
		const id = requestId
		// Capture the caller before entering the timer. Parameter values can contain wallet or transaction data.
		const timeoutError = new Error(
			`Chromium DevTools command ${method} did not complete within ${timeoutMilliseconds.toString()}ms (request ${id.toString()}, session ${sessionId ?? 'page'}${method === 'Runtime.evaluate' && typeof params['awaitPromise'] === 'boolean' ? `, awaitPromise ${String(params['awaitPromise'])}` : ''})`,
		)
		return await new Promise<unknown>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				pending.delete(id)
				timeoutError.message += `\nChromium diagnostics: socket readyState ${String(socket.readyState ?? 'unknown')}; ${browser.readDiagnostics?.() ?? `browser ${browser.isExited() ? 'exited' : 'running'}`}; recent events: ${recentEvents.join(', ') || 'none'}`
				reject(timeoutError)
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
