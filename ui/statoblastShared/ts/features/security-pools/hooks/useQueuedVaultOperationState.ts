import type { Signal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { QueuedVaultOperationState, SecurityVaultActionResult } from '@zoltar/ui-core-shared/types/contracts.js'

type Parameters = {
	enabled: boolean
	selectionKey: string
	managerAddress: Address | undefined
	result: Signal<SecurityVaultActionResult | undefined>
	onFinalized: () => Promise<unknown>
	loadState: (managerAddress: Address, result: SecurityVaultActionResult) => Promise<QueuedVaultOperationState>
}

export function useQueuedVaultOperationState({ enabled, selectionKey, managerAddress, result, loadState, onFinalized }: Parameters) {
	const currentSelectionKey = useRef(selectionKey)
	currentSelectionKey.current = selectionKey
	const queuedOperationReadVersion = useRef(0)
	const reconcileQueuedOperation = async (managerAddress: Address) => {
		const submitted = result.value
		if (submitted?.queuedOperation === undefined || submitted.stagedExecution !== undefined) return true
		const selectionKey = currentSelectionKey.current
		const version = ++queuedOperationReadVersion.current
		const state = await loadState(managerAddress, submitted).catch((): QueuedVaultOperationState => ({ status: 'missing' }))
		const current = result.value
		if (version !== queuedOperationReadVersion.current || currentSelectionKey.current !== selectionKey || current?.hash !== submitted.hash) return false
		result.value = { ...current, queuedOperationState: state, ...(state.execution === undefined ? {} : { stagedExecution: state.execution }) }
		const terminal = state.status !== 'queued' && state.status !== 'manual-queued' && state.status !== 'missing'
		if (terminal) await onFinalized()
		return terminal
	}

	const queuedResultHash = result.value?.queuedOperation === undefined ? undefined : result.value.hash
	useEffect(() => {
		if (!enabled || queuedResultHash === undefined || managerAddress === undefined) return
		let canceled = false
		let timer: ReturnType<typeof setTimeout> | undefined
		const refresh = async () => {
			const terminal = await reconcileQueuedOperation(managerAddress)
			if (!canceled && !terminal) timer = setTimeout(() => void refresh(), 3_000)
		}
		void refresh()
		return () => {
			canceled = true
			queuedOperationReadVersion.current++
			if (timer !== undefined) clearTimeout(timer)
		}
	}, [enabled, selectionKey, queuedResultHash, managerAddress])

	return reconcileQueuedOperation
}
