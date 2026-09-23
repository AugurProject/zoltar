import { isRecord } from './api-validation.ts'
import type { AccountDetailOptions, AccountReference, ActivityRecord, CanonicalRecovery, DetailOptions, DialogSnapshot, LiveEventPayload, LoadOptions, LogReference, RichListRecord } from './browser-types.ts'
import type { ActivityDetailState } from './activity-detail-state.ts'
import type { CanonicalState } from './canonical-state.ts'
import type { ScannerLiveState } from './scanner-live-state.ts'
import { activityRefreshRetention, createLiveRouteRefreshCoordinator, historyInvalidationNotice, isHistoryInvalidationReason } from './live-update.ts'
import { renderExplorerPage } from './explorer-page.ts'
import { classifyRoute } from './routes.ts'

interface LiveCoordinatorDeps {
	lookup: {
		(selector: '#more' | '#richlist-more'): HTMLButtonElement
		(selector: string): HTMLElement
	}
	canonicalState: CanonicalState
	activityDetailState: ActivityDetailState
	liveState: ScannerLiveState
	feed: HTMLElement
	dialog: HTMLDialogElement
	detailContent: HTMLElement
	isDemo: boolean
	getPageUrl: () => URL
	selectedChainId: () => string
	requiredChainId: () => string
	loadSystemState: (options?: LoadOptions) => Promise<boolean>
	loadOperations: (options?: { live?: boolean }) => Promise<boolean>
	loadContracts: (options?: LoadOptions) => Promise<boolean>
	loadRichList: (options?: LoadOptions) => Promise<boolean>
	loadAddressProfile: (options?: LoadOptions) => Promise<boolean>
	loadLogs: (options?: LoadOptions) => Promise<boolean>
	openAccountTransactions: (account: AccountReference, options?: AccountDetailOptions) => Promise<boolean>
	restorePendingCanonicalAccount: () => Promise<boolean>
	eventDrawers: () => HTMLElement[]
	drawerLogFor: (drawer: HTMLElement) => ActivityRecord | LogReference | undefined
	openDetail: (log: ActivityRecord | LogReference, options?: DetailOptions) => Promise<boolean>
	restorePendingCanonicalLog: () => Promise<boolean>
	captureAccountDialogSnapshot: () => DialogSnapshot | undefined
	completeCanonicalRefresh: () => void
	showCanonicalDialogStatus: (title: string, detail: string) => void
	syncCanonicalDialogStatus: () => void
	updateFreshness: () => void
	updateConnectionStatus: () => void
	queryCache: { clear: () => void; get: (path: string) => Promise<unknown> }
	richListRoute: { items: RichListRecord[] }
	addressProfileRoute: { profile: RichListRecord | undefined }
	applyDemoBlock: (payload: LiveEventPayload) => void
	observeDemoReorg: (address: string | undefined) => void
	invalidateAddressIdentityCache: (chainId: string, missesOnly?: boolean) => void
	clearAddressIdentityCache: () => void
}

export const createLiveCoordinator = (deps: LiveCoordinatorDeps) => {
	const {
		canonicalState,
		activityDetailState,
		liveState,
		feed,
		dialog,
		detailContent,
		isDemo,
		selectedChainId,
		requiredChainId,
		loadSystemState,
		loadOperations,
		loadContracts,
		loadRichList,
		loadAddressProfile,
		loadLogs,
		openAccountTransactions,
		restorePendingCanonicalAccount,
		eventDrawers,
		drawerLogFor,
		openDetail,
		restorePendingCanonicalLog,
		captureAccountDialogSnapshot,
		completeCanonicalRefresh,
		showCanonicalDialogStatus,
		syncCanonicalDialogStatus,
		updateFreshness,
		updateConnectionStatus,
		queryCache,
		richListRoute,
		addressProfileRoute,
		invalidateAddressIdentityCache,
	} = deps
	const $ = deps.lookup
	const isSystem = () => classifyRoute(location.pathname) === 'system'
	const isOperations = () => classifyRoute(location.pathname) === 'operations'
	const isContracts = () => classifyRoute(location.pathname) === 'contracts'
	const isRichList = () => classifyRoute(location.pathname) === 'richlist'
	const isAddress = () => classifyRoute(location.pathname) === 'address'
	const isExplorer = () => classifyRoute(location.pathname) === 'explorer'
	const isActivity = () => classifyRoute(location.pathname) === 'activity'
	const refreshAfterUpdates = async (_count: number, _forceContentRefresh: boolean, recovery: CanonicalRecovery | undefined): Promise<boolean> => {
		if (canonicalState.recovery !== undefined && canonicalState.recovery !== recovery) return await canonicalState.recovery.promise
		if (isSystem()) {
			const contentRefreshed = await loadSystemState({ live: true })
			if (contentRefreshed && canonicalState.refreshRequired && canonicalState.recovery === undefined) completeCanonicalRefresh()
			return contentRefreshed
		}
		if (isOperations()) {
			const contentRefreshed = await loadOperations({ live: true })
			if (contentRefreshed && canonicalState.refreshRequired && canonicalState.recovery === undefined) completeCanonicalRefresh()
			return contentRefreshed
		}
		if (isContracts()) {
			const contentRefreshed = await loadContracts({ live: true })
			if (contentRefreshed && canonicalState.refreshRequired && canonicalState.recovery === undefined) completeCanonicalRefresh()
			return contentRefreshed
		}
		if (isRichList()) {
			const contentRefreshed = await loadRichList({ live: true })
			if (contentRefreshed && canonicalState.recovery === undefined && activityDetailState.pendingCanonicalAccount === undefined && activityDetailState.activeAccount && dialog.open) {
				const account = activityDetailState.activeAccount
				const refreshedAccount = richListRoute.items.find(item => String(item.chain_id) === String(account.chain_id) && item.address.toLowerCase() === account.address.toLowerCase())
				await openAccountTransactions(refreshedAccount ?? account, { live: true })
			}
			const canonicalDetailRefreshed = contentRefreshed && activityDetailState.pendingCanonicalAccount && canonicalState.recovery === undefined ? await restorePendingCanonicalAccount() : true
			const fullyRefreshed = contentRefreshed && canonicalDetailRefreshed
			if (fullyRefreshed && canonicalState.refreshRequired && canonicalState.recovery === undefined) completeCanonicalRefresh()
			return fullyRefreshed
		}
		if (isAddress()) {
			const contentRefreshed = await loadAddressProfile({ live: true })
			if (
				contentRefreshed &&
				canonicalState.recovery === undefined &&
				activityDetailState.pendingCanonicalAccount === undefined &&
				activityDetailState.activeAccount &&
				dialog.open &&
				addressProfileRoute.profile &&
				String(addressProfileRoute.profile.chain_id) === String(activityDetailState.activeAccount.chain_id) &&
				addressProfileRoute.profile.address.toLowerCase() === activityDetailState.activeAccount.address.toLowerCase()
			)
				await openAccountTransactions(addressProfileRoute.profile, { live: true })
			const canonicalDetailRefreshed = contentRefreshed && activityDetailState.pendingCanonicalAccount && canonicalState.recovery === undefined ? await restorePendingCanonicalAccount() : true
			const fullyRefreshed = contentRefreshed && canonicalDetailRefreshed
			if (fullyRefreshed && canonicalState.refreshRequired && canonicalState.recovery === undefined) completeCanonicalRefresh()
			return fullyRefreshed
		}
		if (isExplorer()) {
			queryCache.clear()
			const refreshed = await renderExplorerPage(location.pathname, requiredChainId(), path => queryCache.get(path), true)
			if (refreshed && canonicalState.refreshRequired && canonicalState.recovery === undefined) completeCanonicalRefresh()
			return refreshed
		}
		const activityRetention = activityRefreshRetention(canonicalState.refreshRequired, activityDetailState.pendingCanonicalActivityCount, feed.querySelectorAll<HTMLElement>('.log-row').length)
		const contentRefreshed = await loadLogs({
			live: true,
			...activityRetention,
		})
		const detailResults = contentRefreshed
			? await Promise.all(
					eventDrawers().map(drawer => {
						const log = drawerLogFor(drawer)
						return log === undefined ? Promise.resolve(true) : openDetail(log, { live: true, canonicalRecovery: canonicalState.refreshRequired })
					}),
				)
			: []
		const canonicalDetailRefreshed = detailResults.every(Boolean)
		const fullyRefreshed = contentRefreshed && canonicalDetailRefreshed
		if (fullyRefreshed && canonicalState.refreshRequired && canonicalState.recovery === undefined) completeCanonicalRefresh()
		return fullyRefreshed
	}

	const requestRouteRefresh = createLiveRouteRefreshCoordinator(refreshAfterUpdates, () => canonicalState.recovery)

	const refreshCanonicalViews = (title: string, detail: string) => {
		canonicalState.dataGeneration++
		if (canonicalState.recovery !== undefined) {
			canonicalState.recovery.pendingRefresh = true
			if (isActivity()) {
				const visibleCount = feed.querySelectorAll<HTMLElement>('.log-row').length
				activityDetailState.pendingCanonicalActivityCount = Math.max(activityDetailState.pendingCanonicalActivityCount ?? 0, visibleCount)
			}
			canonicalState.recovery.title = title
			canonicalState.recovery.detail = detail
			$('#freshness-title').textContent = title
			$('#freshness-detail').textContent = detail
			showCanonicalDialogStatus(title, detail)
			return canonicalState.recovery.promise
		}
		const recovery: CanonicalRecovery = {
			chainId: requiredChainId(),
			title,
			detail,
			logToRefresh: activityDetailState.activeLog && document.querySelector('.event-detail-drawer') ? activityDetailState.activeLog : undefined,
			accountToRefresh: activityDetailState.activeAccount && dialog.open ? activityDetailState.activeAccount : undefined,
			accountDialogSnapshot: activityDetailState.activeAccount && dialog.open ? captureAccountDialogSnapshot() : undefined,
			pendingRefresh: false,
			promise: Promise.resolve(false),
		}
		if (isActivity()) activityDetailState.pendingCanonicalActivityCount = feed.querySelectorAll<HTMLElement>('.log-row').length
		if (recovery.logToRefresh) activityDetailState.pendingCanonicalLog = recovery.logToRefresh
		if (recovery.accountToRefresh) {
			activityDetailState.pendingCanonicalAccount = recovery.accountToRefresh
			activityDetailState.pendingAccountDialogSnapshot = recovery.accountDialogSnapshot
		}
		canonicalState.recovery = recovery
		canonicalState.refreshRequired = true
		if (isActivity()) {
			$('#more').hidden = true
			$('#more').disabled = true
		}
		if (isRichList()) {
			$('#richlist-more').hidden = true
			$('#richlist-more').disabled = true
		}
		const accountMore = detailContent.querySelector<HTMLButtonElement>('.account-transactions-more')
		if (accountMore !== null) {
			accountMore.hidden = true
			accountMore.disabled = true
		}
		const banner = $('#freshness-banner')
		banner.hidden = false
		$('#freshness-title').textContent = title
		$('#freshness-detail').textContent = detail
		showCanonicalDialogStatus(title, detail)
		recovery.promise = (async () => {
			try {
				while (true) {
					recovery.pendingRefresh = false
					const refreshed = await requestRouteRefresh(1, true)
					if (canonicalState.recovery !== recovery || selectedChainId() !== recovery.chainId) return false
					if (recovery.pendingRefresh) continue
					if (!refreshed) return false
					let detailRefreshed = true
					if (recovery.logToRefresh && document.querySelector('.event-detail-drawer')) {
						activityDetailState.pendingCanonicalLog = recovery.logToRefresh
						const restored = await restorePendingCanonicalLog()
						detailRefreshed = restored || !document.querySelector('.event-detail-drawer') || recovery.logToRefresh === undefined
					}
					if (recovery.accountToRefresh && dialog.open) {
						activityDetailState.pendingCanonicalAccount = recovery.accountToRefresh
						activityDetailState.pendingAccountDialogSnapshot = captureAccountDialogSnapshot()
						const restored = await restorePendingCanonicalAccount()
						detailRefreshed = (restored || !dialog.open || recovery.accountToRefresh === undefined) && detailRefreshed
					}
					if (recovery.pendingRefresh) continue
					if (!detailRefreshed) return false
					completeCanonicalRefresh()
					return true
				}
			} finally {
				if (canonicalState.recovery === recovery) {
					canonicalState.recovery = undefined
					syncCanonicalDialogStatus()
					updateFreshness()
				}
			}
		})()
		return recovery.promise
	}

	const scheduleBlockRefresh = () => {
		liveState.blockRefreshTimer = window.setTimeout(() => {
			liveState.blockRefreshTimer = undefined
			if (canonicalState.recovery !== undefined) {
				void canonicalState.recovery.promise.finally(() => {
					if (liveState.pendingBlockUpdates > 0 && liveState.blockRefreshTimer === undefined) scheduleBlockRefresh()
				})
				return
			}
			const count = liveState.pendingBlockUpdates
			liveState.pendingBlockUpdates = 0
			void requestRouteRefresh(count)
		}, 1_000)
	}

	const queueBlockRefresh = () => {
		liveState.pendingBlockUpdates++
		if (liveState.blockRefreshTimer === undefined) scheduleBlockRefresh()
	}

	const connectStream = () => {
		if (isDemo && deps.getPageUrl().searchParams.get('streamDemo') !== '1') {
			updateConnectionStatus()
			return
		}
		if (liveState.stream !== undefined) return
		const streamQuery = new URLSearchParams()
		if (isDemo && deps.getPageUrl().searchParams.get('reorgDemo') === '1') streamQuery.set('reorg', '1')
		if (isDemo && deps.getPageUrl().searchParams.get('burstDemo') === '1') streamQuery.set('burst', '1')
		const streamPath = `/api/v1/stream${streamQuery.size > 0 ? `?${streamQuery}` : ''}`
		const nextStream = new EventSource(streamPath)
		liveState.stream = nextStream
		nextStream.addEventListener('open', () => {
			updateConnectionStatus()
			if (liveState.streamHasOpened) void requestRouteRefresh(1)
			liveState.streamHasOpened = true
		})
		nextStream.addEventListener('error', () => {
			updateConnectionStatus()
		})
		const eventPayload = (event: MessageEvent, label: string): LiveEventPayload | undefined => {
			try {
				const value: unknown = JSON.parse(String(event.data))
				if (!isRecord(value) || (typeof value['chainId'] !== 'string' && typeof value['chainId'] !== 'number')) throw new Error('Missing chainId')
				const blockNumber = value['blockNumber']
				const depth = value['depth']
				const reason = value['reason']
				if (blockNumber !== undefined && typeof blockNumber !== 'string' && typeof blockNumber !== 'number') throw new Error('Invalid blockNumber')
				if (depth !== undefined && typeof depth !== 'string' && typeof depth !== 'number') throw new Error('Invalid depth')
				if (reason !== undefined && !isHistoryInvalidationReason(reason)) throw new Error('Invalid history invalidation reason')
				return {
					chainId: value['chainId'],
					...(blockNumber === undefined ? {} : { blockNumber }),
					...(depth === undefined ? {} : { depth }),
					...(reason === undefined ? {} : { reason }),
				}
			} catch (error) {
				console.error(`${label} notification could not be decoded (${error instanceof Error ? error.name : typeof error})`)
				return undefined
			}
		}
		const selectedEventPayload = (event: MessageEvent, label: string) => {
			const payload = eventPayload(event, label)
			return payload !== undefined && String(payload.chainId) === selectedChainId() ? payload : undefined
		}
		const liveUpdate = (event: MessageEvent) => {
			if (selectedEventPayload(event, 'Live update') === undefined) return
			queueBlockRefresh()
		}
		nextStream.addEventListener('block', event => {
			const payload = eventPayload(event, 'Block update')
			if (payload === undefined) return
			deps.applyDemoBlock(payload)
			invalidateAddressIdentityCache(String(payload.chainId), true)
			if (String(payload.chainId) === selectedChainId()) liveUpdate(event)
		})
		nextStream.addEventListener('status', liveUpdate)
		nextStream.addEventListener('reorg', async event => {
			const payload = eventPayload(event, 'Reorganization')
			if (payload === undefined) return
			if (payload.reason === undefined) {
				console.error('Reorganization notification could not be decoded (missing history invalidation reason)')
				return
			}
			if (isDemo) {
				deps.observeDemoReorg(activityDetailState.activeAccount?.address.toLowerCase())
			}
			invalidateAddressIdentityCache(String(payload.chainId))
			if (String(payload.chainId) !== selectedChainId()) return
			const depth = String(payload.depth ?? 'unknown')
			const notice = historyInvalidationNotice(payload.reason, depth)
			await refreshCanonicalViews(notice.title, notice.detail)
		})
		nextStream.addEventListener('reset', async () => {
			deps.clearAddressIdentityCache()
			await refreshCanonicalViews('Live replay window expired', 'Refreshing views from the current database state.')
		})
	}

	return { requestRouteRefresh, refreshCanonicalViews, connectStream }
}
