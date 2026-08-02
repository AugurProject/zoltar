export function createSettingsUpdateQueue() {
	let tail = Promise.resolve()
	return <T>(update: () => Promise<T>) => {
		const result = tail.then(update)
		tail = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}
}
