export type ArbitragerShutdownController = ReturnType<typeof createArbitragerShutdownController>

export function createArbitragerShutdownController() {
	let requested = false
	let disposed = false
	const waiters = new Set<() => void>()
	const requestShutdown = () => {
		requested = true
		for (const finish of [...waiters]) finish()
	}
	process.on('SIGINT', requestShutdown)
	process.on('SIGTERM', requestShutdown)
	return {
		[Symbol.dispose]: () => {
			if (disposed) return
			disposed = true
			process.off('SIGINT', requestShutdown)
			process.off('SIGTERM', requestShutdown)
			for (const finish of [...waiters]) finish()
		},
		isRequested: () => requested,
		requestShutdown,
		wait: (milliseconds: number) => {
			if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error('Shutdown wait must be a non-negative integer')
			if (requested) return Promise.resolve()
			return new Promise<void>(resolve => {
				let timer: ReturnType<typeof setTimeout>
				const finish = () => {
					clearTimeout(timer)
					waiters.delete(finish)
					resolve()
				}
				timer = setTimeout(finish, milliseconds)
				waiters.add(finish)
			})
		},
	}
}
