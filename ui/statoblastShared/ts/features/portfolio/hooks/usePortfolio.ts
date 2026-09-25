import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { createLoadController } from '@zoltar/ui-core-shared/lib/loadState.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { loadPortfolioSnapshots, type PortfolioPoolSnapshot } from '../../../protocol/portfolio.js'

const PORTFOLIO_LOAD_TIMEOUT_MILLISECONDS = 120_000

type PortfolioLoadDependencies = {
	loadPortfolioSnapshots: (accountAddress: Address) => Promise<PortfolioPoolSnapshot[]>
	waitUntilReady: () => Promise<void>
}

const defaultPortfolioLoadDependencies: PortfolioLoadDependencies = {
	loadPortfolioSnapshots: async accountAddress => await loadPortfolioSnapshots(createConnectedReadClient(), accountAddress),
	waitUntilReady: async () => await getActiveBackend().waitUntilReady?.(),
}

/** Loads the account's positions across all pools whenever the portfolio is shown or the account or environment changes. */
export function usePortfolio({ accountAddress, enabled, environmentRefreshKey }: { accountAddress: Address | undefined; enabled: boolean; environmentRefreshKey: number }, dependencies: PortfolioLoadDependencies = defaultPortfolioLoadDependencies) {
	const controllerRef = useRef<ReturnType<typeof createLoadController> | undefined>(undefined)
	if (controllerRef.current === undefined) controllerRef.current = createLoadController({ timeoutMilliseconds: PORTFOLIO_LOAD_TIMEOUT_MILLISECONDS })
	const controller = controllerRef.current
	const nextLoad = useRequestGuard()
	const snapshots = useSignal<PortfolioPoolSnapshot[] | undefined>(undefined)
	const loadedKey = useSignal<string | undefined>(undefined)
	const error = useSignal<string | undefined>(undefined)
	const contextKey = accountAddress === undefined ? undefined : `${environmentRefreshKey.toString()}:${accountAddress.toLowerCase()}`

	const load = async () => {
		if (accountAddress === undefined || contextKey === undefined) return
		const isCurrent = nextLoad()
		await controller.run({
			isCurrent,
			onStart: () => {
				error.value = undefined
			},
			waitUntilReady: dependencies.waitUntilReady,
			load: async () => await dependencies.loadPortfolioSnapshots(accountAddress),
			onSuccess: result => {
				snapshots.value = result
				loadedKey.value = contextKey
			},
			onError: loadError => {
				error.value = getErrorMessage(loadError, 'Failed to load your positions')
			},
		})
	}

	// Every visit reloads, so positions changed on a pool page are current when the user comes back; the previous result stays visible meanwhile.
	useEffect(() => {
		if (!enabled || contextKey === undefined) return
		void load()
	}, [contextKey, enabled])

	const current = contextKey !== undefined && loadedKey.value === contextKey
	return {
		error: error.value,
		loading: controller.isLoading.value,
		onRetry: () => void load(),
		snapshots: current ? snapshots.value : undefined,
	}
}

export type PortfolioLoadState = ReturnType<typeof usePortfolio>
