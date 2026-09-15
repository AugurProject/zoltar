import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { QueuedVaultOperationState, SecurityVaultActionResult } from '@zoltar/ui-core-shared/types/contracts.js'

type TrackedOperation = { managerAddress: Address; selectionKey: string; result: SecurityVaultActionResult }
type Parameters = {
	enabled: boolean
	selectionKey: string
	onFinalized: () => Promise<unknown>
	loadState: (managerAddress: Address, result: SecurityVaultActionResult) => Promise<QueuedVaultOperationState>
}

function isUnresolved(result: SecurityVaultActionResult) {
	if (result.stagedExecution !== undefined) return false
	const status = result.queuedOperationState?.status
	return status === undefined || status === 'queued' || status === 'manual-queued' || status === 'missing'
}

export function useQueuedVaultOperationState({ enabled, selectionKey, loadState, onFinalized }: Parameters) {
	const tracked = useSignal<Record<string, TrackedOperation>>({})
	const currentSelectionKey = useRef(selectionKey)
	currentSelectionKey.current = selectionKey
	const readVersions = useRef(new Map<string, number>())
	const epoch = useRef(0)

	const track = (managerAddress: Address, result: SecurityVaultActionResult) => {
		if (result.queuedOperation === undefined) return result
		const key = `${managerAddress.toLowerCase()}:${result.queuedOperation.operationId}`
		const existing = tracked.value[key]
		if (existing?.result.hash === result.hash) return existing.result
		tracked.value = { ...tracked.value, [key]: { managerAddress, selectionKey, result } }
		return result
	}

	const reconcile = async (managerAddress?: Address) => {
		const readEpoch = epoch.current
		const entries = Object.entries(tracked.value).filter(([, entry]) => entry.selectionKey === currentSelectionKey.current && isUnresolved(entry.result) && (managerAddress === undefined || entry.managerAddress.toLowerCase() === managerAddress.toLowerCase()))
		await Promise.all(
			entries.map(async ([key, submitted]) => {
				const version = (readVersions.current.get(key) ?? 0) + 1
				readVersions.current.set(key, version)
				const state = await loadState(submitted.managerAddress, submitted.result).catch((): QueuedVaultOperationState => ({ status: 'missing' }))
				const current = tracked.value[key]
				if (epoch.current !== readEpoch || readVersions.current.get(key) !== version || currentSelectionKey.current !== submitted.selectionKey || current?.result.hash !== submitted.result.hash) return
				const result = { ...current.result, queuedOperationState: state, ...(state.execution === undefined ? {} : { stagedExecution: state.execution }) }
				tracked.value = { ...tracked.value, [key]: { ...current, result } }
				if (!isUnresolved(result)) await onFinalized()
			}),
		)
		return !Object.values(tracked.value).some(entry => entry.selectionKey === currentSelectionKey.current && isUnresolved(entry.result))
	}

	const pendingKeys = Object.entries(tracked.value)
		.filter(([, entry]) => entry.selectionKey === selectionKey && isUnresolved(entry.result))
		.map(([key]) => key)
		.sort()
		.join('|')
	useEffect(() => {
		if (!enabled || pendingKeys === '') return
		let canceled = false
		let timer: ReturnType<typeof setTimeout> | undefined
		const refresh = async () => {
			const terminal = await reconcile()
			if (!canceled && !terminal) timer = setTimeout(() => void refresh(), 3_000)
		}
		void refresh()
		return () => {
			canceled = true
			epoch.current++
			if (timer !== undefined) clearTimeout(timer)
		}
	}, [enabled, selectionKey, pendingKeys])

	return {
		track,
		reconcile,
		operations: Object.values(tracked.value)
			.filter(entry => entry.selectionKey === selectionKey)
			.map(entry => entry.result),
	}
}
