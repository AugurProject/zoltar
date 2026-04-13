type RunLoadRequestParameters<TResult> = {
	isCurrent?: () => boolean
	setLoading: (value: boolean) => void
	load: () => Promise<TResult>
	onStart?: () => void
	onSuccess: (result: TResult) => Promise<void> | void
	onError?: (error: unknown) => Promise<void> | void
}

export async function runLoadRequest<TResult>({ isCurrent, setLoading, load, onStart, onSuccess, onError }: RunLoadRequestParameters<TResult>) {
	const isCurrentRequest = isCurrent ?? (() => true)
	setLoading(true)
	onStart?.()
	try {
		const result = await load()
		if (!isCurrentRequest()) return undefined
		await onSuccess(result)
		return result
	} catch (error) {
		if (!isCurrentRequest()) return undefined
		await onError?.(error)
		return undefined
	} finally {
		if (isCurrentRequest()) {
			setLoading(false)
		}
	}
}
