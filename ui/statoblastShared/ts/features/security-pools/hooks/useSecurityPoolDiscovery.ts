import { useSignal } from '@preact/signals'
import { useRef } from 'preact/hooks'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { readOperationClient, type ReadOperation } from '@zoltar/ui-core-shared/lib/readOperation.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { loadSecurityPoolPage } from '../../../protocol/securityPools.js'
import type { SecurityPoolDiscoveryPage, SecurityPoolRegistryPage } from '../../../types/contracts.js'

export type UseSecurityPoolDiscoveryDependencies = {
	loadSecurityPoolPage: (pageIndex: number, pageSize: number, operation: ReadOperation) => Promise<SecurityPoolRegistryPage>
	waitForSecurityPoolReadBackend: () => Promise<void>
}

const defaultDependencies: UseSecurityPoolDiscoveryDependencies = {
	loadSecurityPoolPage: async (pageIndex, pageSize, operation) => await loadSecurityPoolPage(readOperationClient(createConnectedReadClient(), operation), pageIndex, pageSize),
	waitForSecurityPoolReadBackend: async () => {
		await getActiveBackend().waitUntilReady?.()
	},
}

/** Pages of the pool factory registry for Browse pools; each answer echoes its request key so a superseded page never lands. */
export function useSecurityPoolDiscovery({ enabled, environmentRefreshKey }: { enabled: boolean; environmentRefreshKey: number }, dependencies: UseSecurityPoolDiscoveryDependencies = defaultDependencies) {
	const page = useSignal<SecurityPoolDiscoveryPage | undefined>(undefined)
	const pageError = useSignal<string | undefined>(undefined)
	const pageLoad = useLoadController()
	const nextPageLoad = useRequestGuard()
	const latestEnvironmentRefreshKey = useRef(environmentRefreshKey)
	latestEnvironmentRefreshKey.current = environmentRefreshKey

	/** Rejects when the read fails, so the paged discovery offers a retry. */
	const loadPage = async (pageIndex: number, pageSize: number, requestKey: string) => {
		if (!enabled) return
		const requestedEnvironmentRefreshKey = environmentRefreshKey
		const isRequestCurrent = nextPageLoad()
		const isCurrent = () => isRequestCurrent() && latestEnvironmentRefreshKey.current === requestedEnvironmentRefreshKey
		let failure: unknown
		await pageLoad.run({
			isCurrent,
			onStart: () => {
				pageError.value = undefined
			},
			waitUntilReady: dependencies.waitForSecurityPoolReadBackend,
			load: async operation => await dependencies.loadSecurityPoolPage(pageIndex, pageSize, operation),
			onSuccess: loadedPage => {
				page.value = { ...loadedPage, requestKey }
			},
			onError: error => {
				failure = error
				pageError.value = getErrorMessage(error, securityPoolCopy.poolPageLoadError)
			},
		})
		if (failure !== undefined) throw failure
	}

	return {
		loadSecurityPoolPage: loadPage,
		loadingSecurityPoolPage: pageLoad.isLoading.value,
		securityPoolPage: page.value,
		securityPoolPageError: pageError.value,
	}
}
