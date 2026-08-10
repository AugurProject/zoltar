export const createConcurrencyGate = <T>(limit: number, busy: () => T): ((operation: () => Promise<T>) => Promise<T>) => {
	let active = 0
	return async (operation) => {
		if (active >= limit) return busy()
		active++
		try {
			return await operation()
		} finally {
			active--
		}
	}
}
