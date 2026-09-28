import { useSignal } from '@preact/signals'
import { useRef } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { appQueryCache, isSameQueryData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { useQueryState } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import type { SecurityPoolBrowsePage, SecurityPoolPage } from '@zoltar/ui-core-shared/types/contracts.js'

/** Pool registry pages keyed by their request key; each new block refreshes the visible page in place. */
const securityPoolPageQueries = appQueryCache.createStore<SecurityPoolPage>()

type UseSecurityPoolBrowsePageParameters = {
	accountAddress: Address | undefined
	loadSecurityPoolPage: (pageIndex: number, pageSize: number, accountAddress: Address | undefined) => Promise<SecurityPoolPage>
	setOverviewError: (message: string | undefined) => void
	waitForSecurityPoolReadBackend: () => Promise<void>
}

/** The pool registry's browse page: an explicit load that shows the loading state, and an in-place refresh that keeps the page visible. */
export function useSecurityPoolBrowsePage({ accountAddress, loadSecurityPoolPage, setOverviewError, waitForSecurityPoolReadBackend }: UseSecurityPoolBrowsePageParameters) {
	const securityPoolPage = useSignal<SecurityPoolBrowsePage | undefined>(undefined)
	const securityPoolPageLoad = useLoadController()
	const nextSecurityPoolPageLoad = useRequestGuard()
	// Each background request and foreground commit retires older background answers.
	const commitVersionRef = useRef(0)
	const pageQuery = useQueryState(securityPoolPageQueries, securityPoolPage.value?.requestKey)

	const loadBrowseSecurityPoolPage = async (pageIndex: number, pageSize: number, requestKey: string) => {
		const isCurrent = nextSecurityPoolPageLoad()
		await securityPoolPageLoad.run({
			isCurrent,
			onStart: () => {
				if (!isCurrent()) return
				setOverviewError(undefined)
			},
			waitUntilReady: waitForSecurityPoolReadBackend,
			load: async () => await loadSecurityPoolPage(pageIndex, pageSize, accountAddress),
			onSuccess: page => {
				commitVersionRef.current += 1
				securityPoolPageQueries.set(requestKey, page)
				securityPoolPage.value = { ...page, requestKey }
			},
			onError: error => {
				setOverviewError(getErrorMessage(error, 'Failed to load security pools'))
			},
		})
	}

	const refreshBrowseSecurityPoolPage = async () => {
		const current = securityPoolPage.value
		if (current === undefined || securityPoolPageLoad.isLoading.peek()) return
		const commitVersion = ++commitVersionRef.current
		try {
			const page = await securityPoolPageQueries.fetch(current.requestKey, async () => await loadSecurityPoolPage(current.pageIndex, current.pageSize, accountAddress))
			if (commitVersionRef.current !== commitVersion || securityPoolPageLoad.isLoading.peek() || securityPoolPage.value?.requestKey !== current.requestKey) return
			if (isSameQueryData({ ...page, requestKey: current.requestKey }, current)) return
			securityPoolPage.value = { ...page, requestKey: current.requestKey }
		} catch (error) {
			// A failed background read keeps the visible page; its age stays visible and the next block retries.
			void error
		}
	}

	return {
		loadBrowseSecurityPoolPage,
		loadingSecurityPoolPage: securityPoolPageLoad.isLoading.value,
		refreshBrowseSecurityPoolPage,
		securityPoolPage: securityPoolPage.value,
		securityPoolPageFreshness: { refreshing: pageQuery?.fetching === true, updatedAt: pageQuery?.updatedAt },
	}
}
