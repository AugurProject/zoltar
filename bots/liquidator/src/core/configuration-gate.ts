export function createConfigurationMutationGate(isScanning: () => boolean) {
	let active = false
	return {
		isActive() {
			return active
		},
		async run<T>(mutation: () => Promise<T>) {
			if (active || isScanning()) throw new Error('Wait for the active scan or configuration update to finish')
			active = true
			try {
				return await mutation()
			} finally {
				active = false
			}
		},
	}
}
