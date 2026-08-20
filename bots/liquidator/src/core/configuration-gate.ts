export function createConfigurationMutationGate(isScanning: () => boolean) {
	let active = false
	let queue = Promise.resolve()
	return {
		isActive() {
			return active
		},
		async run<T>(mutation: () => Promise<T>) {
			const result = queue.then(async () => {
				while (isScanning()) await new Promise(resolve => setTimeout(resolve, 10))
				active = true
				try {
					return await mutation()
				} finally {
					active = false
				}
			})
			queue = result.then(
				() => undefined,
				() => undefined,
			)
			return await result
		},
	}
}
