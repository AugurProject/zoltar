import type { Browser } from 'happy-dom'

type BrowserWindow = ReturnType<Browser['newPage']>['mainFrame']['window']

export function controlReconnectTimers(window: BrowserWindow) {
	const setTimeout = window.setTimeout.bind(window)
	const reconnectTicks = new Map<ReturnType<typeof setTimeout>, () => void>()
	const clearTimeout = window.clearTimeout.bind(window)
	window.setTimeout = (handler, delay, ...args) => {
		if ((delay !== 500 && delay !== 2_000) || typeof handler !== 'function') return setTimeout(handler, delay, ...args)
		const timer = setTimeout(() => undefined, 1)
		clearTimeout(timer)
		reconnectTicks.set(timer, () => handler(...args))
		return timer
	}
	window.clearTimeout = timer => {
		if (timer !== undefined) reconnectTicks.delete(timer)
		clearTimeout(timer)
	}
	return async (ready: () => boolean) => {
		for (let attempt = 0; attempt < 600 && !ready(); attempt++) {
			const tick = reconnectTicks.entries().next().value
			if (tick !== undefined) {
				const [timer, run] = tick
				reconnectTicks.delete(timer)
				run()
			}
			await Bun.sleep(1)
		}
	}
}
