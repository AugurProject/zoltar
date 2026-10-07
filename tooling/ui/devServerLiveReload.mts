import type { ChildProcess } from 'node:child_process'

const waitForDevServerLiveReloadEndpoint = (child: ChildProcess) =>
	new Promise<string>((resolve, reject) => {
		const cleanup = () => {
			child.off('message', onMessage)
			child.off('error', onError)
			child.off('exit', onExit)
		}
		const onError = (error: Error) => {
			cleanup()
			reject(error)
		}
		const onExit = () => onError(new Error('Development server exited before reporting its listening port'))
		const onMessage = (message: unknown) => {
			if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'dev-server-ready') return
			if (!('port' in message) || typeof message.port !== 'number' || !Number.isInteger(message.port) || message.port < 1 || message.port > 65_535) {
				onError(new Error('Development server reported an invalid listening port'))
				return
			}
			cleanup()
			resolve(`http://127.0.0.1:${message.port}/__live-reload`)
		}
		child.on('message', onMessage)
		child.on('error', onError)
		child.on('exit', onExit)
		if (child.exitCode !== null || child.signalCode !== null) onExit()
	})

export const createDevServerLiveReload = () => {
	let stopped = false
	let serverProcess: ChildProcess | undefined
	let endpoint: string | undefined
	let queuedReason: string | undefined
	let timeout: ReturnType<typeof setTimeout> | undefined

	const send = async () => {
		if (stopped || queuedReason === undefined || endpoint === undefined) return
		const reason = queuedReason
		queuedReason = undefined
		try {
			await fetch(`${endpoint}?reason=${encodeURIComponent(reason)}`, { method: 'POST' })
			console.log(`[app:watch] Reload requested (${reason})`)
		} catch (error) {
			console.error(`[app:watch] Failed to signal browser reload because ${reason} changed`)
			console.error(error)
		}
	}
	const queue = (reason: string) => {
		if (stopped) return
		if (timeout !== undefined) clearTimeout(timeout)
		queuedReason = reason
		timeout = setTimeout(() => {
			timeout = undefined
			void send()
		}, 250)
	}
	const connect = async (child: ChildProcess) => {
		endpoint = undefined
		serverProcess = child
		const listeningEndpoint = await waitForDevServerLiveReloadEndpoint(child)
		if (stopped || serverProcess !== child) return undefined
		endpoint = listeningEndpoint
		if (queuedReason !== undefined) queue(queuedReason)
		return endpoint
	}
	const stop = () => {
		stopped = true
		if (timeout !== undefined) clearTimeout(timeout)
	}
	return { queue, connect, stop }
}
