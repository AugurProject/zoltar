type SupportedNetworkChangeCoordinatorParameters = {
	getInFlightCount: () => number
	replaceEnvironment: (canCommit: () => boolean) => Promise<boolean>
}

export function createSupportedNetworkChangeCoordinator({ getInFlightCount, replaceEnvironment }: SupportedNetworkChangeCoordinatorParameters) {
	let replacementPending = false
	let replacementPromise: Promise<void> | undefined
	const replaceWhenSafe = () => {
		if (replacementPromise !== undefined) return replacementPromise
		replacementPromise = (async () => {
			while (replacementPending && getInFlightCount() === 0) {
				replacementPending = false
				const committed = await replaceEnvironment(() => getInFlightCount() === 0)
				if (!committed) replacementPending = true
			}
		})().finally(() => {
			replacementPromise = undefined
		})
		return replacementPromise
	}
	const drainPendingReplacement = async () => {
		await replaceWhenSafe()
		while (replacementPending && getInFlightCount() === 0) await replaceWhenSafe()
	}

	return {
		handleSupportedNetworkChange: async () => {
			replacementPending = true
			await drainPendingReplacement()
		},
		handleTransactionFinished: async () => {
			await drainPendingReplacement()
		},
	}
}
