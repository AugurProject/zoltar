import { batch, useSignal } from '@preact/signals'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'

import type { ChainBackend } from '../../wallet/chainBackend.js'
import { getErrorMessage } from '../../lib/errors.js'

import { getActiveBackend, getActiveSimulationController } from '../../lib/activeEnvironment.js'
import { appBlockWatcher, blockPollIntervalMilliseconds } from '../../lib/dataRefresh.js'

import { useRequestGuard } from '../../lib/requestGuard.js'

import { type ChainClock, loadBackendChainClock } from './readBackendValidation.js'

export function useOnchainClock({
	activeEnvironmentNonce,
	enableChainClock,
	environmentReady,
	readBackendMessage,
	readBackendValidated,
	isReadBackendReady,
	updateReadBackendStatus,
}: {
	activeEnvironmentNonce: number
	enableChainClock: boolean
	environmentReady: boolean
	readBackendMessage: string | undefined
	readBackendValidated: boolean
	isReadBackendReady: () => boolean
	updateReadBackendStatus: (backend: ChainBackend, block?: ChainClock) => void
}) {
	const currentTimestamp = useSignal<bigint | undefined>(getActiveBackend().currentTimestamp)
	const currentBlockNumber = useSignal<bigint | undefined>(undefined)
	const chainClockError = useSignal<string | undefined>(undefined)
	const nextChainClockRefresh = useRequestGuard()
	const chainClockRefreshRef = useRef<{ activeEnvironmentNonce: number; backend: ChainBackend; promise: Promise<void> } | undefined>(undefined)
	const chainClockContextRef = useRef({ activeEnvironmentNonce, enableChainClock })
	const previousChainClockContextRef = useRef({ activeEnvironmentNonce, enableChainClock })
	chainClockContextRef.current = { activeEnvironmentNonce, enableChainClock }
	const clearChainClock = () => {
		batch(() => {
			currentBlockNumber.value = undefined
			currentTimestamp.value = undefined
		})
	}
	const refreshChainClock = (backend: ChainBackend) => {
		const activeRequest = chainClockRefreshRef.current
		if (activeRequest !== undefined && activeRequest.activeEnvironmentNonce === activeEnvironmentNonce && activeRequest.backend === backend) return activeRequest.promise
		const isCurrent = nextChainClockRefresh()
		const requestEnvironmentNonce = activeEnvironmentNonce
		const isCurrentChainClockRequest = () => {
			const context = chainClockContextRef.current
			return isCurrent() && context.enableChainClock && context.activeEnvironmentNonce === requestEnvironmentNonce && getActiveBackend() === backend
		}
		const promise = (async () => {
			try {
				const nextChainClock = await loadBackendChainClock(backend)
				if (!isCurrentChainClockRequest()) return
				batch(() => {
					currentTimestamp.value = nextChainClock.currentTimestamp
					currentBlockNumber.value = nextChainClock.currentBlockNumber
					chainClockError.value = undefined
				})
				updateReadBackendStatus(backend, nextChainClock)
				appBlockWatcher.reportBlock(nextChainClock.currentBlockNumber)
			} catch (error) {
				if (!isCurrentChainClockRequest()) return
				clearChainClock()
				updateReadBackendStatus(backend)
				chainClockError.value = getErrorMessage(error, 'Failed to refresh chain clock')
			}
		})()
		chainClockRefreshRef.current = { activeEnvironmentNonce: requestEnvironmentNonce, backend, promise }
		void promise.finally(() => {
			if (chainClockRefreshRef.current?.promise === promise) chainClockRefreshRef.current = undefined
		})
		return promise
	}
	useLayoutEffect(() => {
		const previousContext = previousChainClockContextRef.current
		const environmentChanged = previousContext.activeEnvironmentNonce !== activeEnvironmentNonce
		previousChainClockContextRef.current = { activeEnvironmentNonce, enableChainClock }
		nextChainClockRefresh()
		chainClockRefreshRef.current = undefined
		if (!enableChainClock || environmentChanged) {
			clearChainClock()
			chainClockError.value = undefined
		}
	}, [activeEnvironmentNonce, enableChainClock])
	useEffect(() => {
		if (!enableChainClock) {
			return
		}
		const backend = getActiveBackend()
		if (backend.isBootstrapped === false) return
		if (!isReadBackendReady()) return

		// The chain clock is the application's block poller: it pauses in a hidden tab and every new block refreshes cached queries.
		return appBlockWatcher.start(
			async () => {
				if (!isReadBackendReady()) return undefined
				await refreshChainClock(backend)
				return currentBlockNumber.peek()
			},
			blockPollIntervalMilliseconds(getActiveSimulationController() !== undefined),
		)
	}, [activeEnvironmentNonce, enableChainClock, environmentReady, readBackendMessage, readBackendValidated])

	return {
		currentTimestamp: currentTimestamp.value,
		currentBlockNumber: currentBlockNumber.value,
		chainClockError: chainClockError.value,
		clearChainClock,
		clearError: () => {
			chainClockError.value = undefined
		},
		refreshChainClock,
	}
}
