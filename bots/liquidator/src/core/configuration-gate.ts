export function createConfigurationMutationGate(isScanning: () => boolean, profileSwitchRequested: () => boolean = () => false) {
	let active = false
	let queue = Promise.resolve()
	return {
		isActive() {
			return active
		},
		async run<T>(mutation: () => Promise<T>) {
			const result = queue.then(async () => {
				while (isScanning()) await new Promise(resolve => setTimeout(resolve, 10))
				if (profileSwitchRequested()) throw new Error('Chain profile switching is in progress; retry after the dashboard reconnects')
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
