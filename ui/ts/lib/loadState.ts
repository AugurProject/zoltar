import { signal, type Signal } from '@preact/signals'

export type LoadPhase = 'idle' | 'loading'
export type LoadableValueState = 'unknown' | 'loading' | 'ready' | 'missing'

type RunLoadOptions<TResult> = {
	isCurrent?: () => boolean
	load: () => Promise<TResult>
	onStart?: () => void
	onSuccess?: (result: TResult) => Promise<void> | void
	onError?: (error: unknown) => Promise<void> | void
}

export type LoadController = {
	phase: Signal<LoadPhase>
	isLoading: Signal<boolean>
	run<TResult>(options: RunLoadOptions<TResult>): Promise<TResult | undefined>
	track<TResult>(work: () => Promise<TResult>): Promise<TResult>
}

type ResolveLoadableValueStateOptions<TValue> = {
	isLoading: boolean
	isMissing: boolean
	value: TValue | undefined
}

export function resolveLoadableValueState<TValue>({ isLoading, isMissing, value }: ResolveLoadableValueStateOptions<TValue>): LoadableValueState {
	if (value !== undefined) return 'ready'
	if (isLoading) return 'loading'
	if (isMissing) return 'missing'
	return 'unknown'
}

type ResolveRequestedLoadableValueStateOptions<TValue, TKey> = {
	currentKey: TKey | undefined
	isLoading: boolean
	resolvedKey: TKey | undefined
	value: TValue | undefined
}

export function resolveRequestedLoadableValueState<TValue, TKey>({ currentKey, isLoading, resolvedKey, value }: ResolveRequestedLoadableValueStateOptions<TValue, TKey>): LoadableValueState {
	if (value !== undefined) return 'ready'
	if (isLoading) return 'loading'
	if (currentKey !== undefined && resolvedKey !== undefined && currentKey === resolvedKey) return 'missing'
	return 'unknown'
}

export function createLoadController(): LoadController {
	const phase = signal<LoadPhase>('idle')
	const isLoading = signal(false)
	let pendingCount = 0

	const syncPhase = () => {
		const nextPhase = pendingCount > 0 ? 'loading' : 'idle'
		phase.value = nextPhase
		isLoading.value = nextPhase === 'loading'
	}

	const track = async <TResult>(work: () => Promise<TResult>) => {
		pendingCount += 1
		syncPhase()
		try {
			return await work()
		} finally {
			pendingCount = Math.max(0, pendingCount - 1)
			syncPhase()
		}
	}

	const run = async <TResult>({ isCurrent, load, onStart, onSuccess, onError }: RunLoadOptions<TResult>) => {
		const isCurrentRequest = isCurrent ?? (() => true)
		return await track(async () => {
			onStart?.()
			try {
				const result = await load()
				if (!isCurrentRequest()) return undefined
				await onSuccess?.(result)
				return result
			} catch (error) {
				if (!isCurrentRequest()) return undefined
				await onError?.(error)
				return undefined
			}
		})
	}

	return {
		isLoading,
		phase,
		run,
		track,
	}
}
