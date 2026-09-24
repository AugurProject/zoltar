import type { AccountDetailOptions, AccountReference, DialogSnapshot, RichListRecord } from './browser-types.ts'
import type { ActivityDetailState } from './activity-detail-state.ts'
import type { CanonicalState } from './canonical-state.ts'
import { createAccountTransactionLoader } from './account-dialog.ts'
import { reconcileTransactionDialogSnapshot, type RefreshGate, urlWithoutLogDetail } from './live-update.ts'

interface AccountDetailRouteDeps {
	activityDetailState: ActivityDetailState
	canonicalState: CanonicalState
	detailContent: HTMLElement
	dialog: HTMLDialogElement
	loaderDeps: Omit<Parameters<typeof createAccountTransactionLoader>[0], 'stagedAccountDialogSnapshot' | 'restoreAccountDialogSnapshot' | 'captureAccountDialogSnapshot' | 'restorePendingCanonicalAccount' | 'openAccountTransactions'>
	detailRefreshGate: RefreshGate
	getIsRichList: () => boolean
	getIsAddress: () => boolean
	getRichListItems: () => RichListRecord[]
	getAddressProfile: () => RichListRecord | undefined
	removeEventDrawers: () => void
	hideCanonicalDialogStatus: () => void
}

export const createAccountDetailRoute = (deps: AccountDetailRouteDeps) => {
	const { activityDetailState, canonicalState, detailContent, dialog, detailRefreshGate, removeEventDrawers, hideCanonicalDialogStatus } = deps
	const captureAccountDialogSnapshot = (): DialogSnapshot | undefined => {
		if (activityDetailState.activeAccountTransactions === undefined) return undefined
		const cards = [...detailContent.querySelectorAll<HTMLElement>('.account-transaction[data-live-key]')]
		const focusedCard = document.activeElement?.closest<HTMLElement>('.account-transaction[data-live-key]')
		const focusable = focusedCard ? [...focusedCard.querySelectorAll<HTMLElement>('a, button, summary')] : []
		const anchorCard = focusedCard ?? cards.find(card => card.getBoundingClientRect().bottom > dialog.getBoundingClientRect().top)
		return {
			loadedCount: activityDetailState.activeAccountTransactions.loaded.length,
			expandedKeys: [...detailContent.querySelectorAll<HTMLElement>('.account-transaction-action[open]')].flatMap(action => {
				const key = action.closest<HTMLElement>('.account-transaction[data-live-key]')?.dataset.liveKey
				return key === undefined ? [] : [key]
			}),
			anchorKey: anchorCard?.dataset.liveKey,
			anchorTop: anchorCard?.getBoundingClientRect().top,
			focusKey: focusedCard?.dataset.liveKey,
			focusIndex: document.activeElement instanceof HTMLElement ? focusable.indexOf(document.activeElement) : -1,
			outsideFocus: document.activeElement instanceof HTMLElement ? document.activeElement.dataset.liveFocus : undefined,
			scrollTop: dialog.scrollTop,
		}
	}

	const restoreAccountDialogSnapshot = (snapshot: DialogSnapshot) => {
		const availableKeys = new Set([...detailContent.querySelectorAll<HTMLElement>('.account-transaction[data-live-key]')].flatMap(card => (card.dataset.liveKey === undefined ? [] : [card.dataset.liveKey])))
		const reconciled = reconcileTransactionDialogSnapshot(snapshot, availableKeys)
		for (const key of reconciled.expandedKeys) {
			if (key === undefined) continue
			const card = detailContent.querySelector<HTMLElement>(`[data-live-key="${CSS.escape(key)}"]`)
			const action = card?.querySelector<HTMLDetailsElement>('.account-transaction-action')
			if (action) action.open = true
		}
		dialog.scrollTop = reconciled.scrollTop ?? snapshot.scrollTop
		if (reconciled.anchorKey && reconciled.anchorTop !== undefined) {
			const anchor = detailContent.querySelector<HTMLElement>(`[data-live-key="${CSS.escape(reconciled.anchorKey)}"]`)
			if (anchor) dialog.scrollTop += anchor.getBoundingClientRect().top - reconciled.anchorTop
		}
		if (reconciled.focusKey && reconciled.focusIndex >= 0) {
			const focusedCard = detailContent.querySelector<HTMLElement>(`[data-live-key="${CSS.escape(reconciled.focusKey)}"]`)
			const focusable = focusedCard ? [...focusedCard.querySelectorAll<HTMLElement>('a, button, summary')] : []
			focusable[reconciled.focusIndex]?.focus({ preventScroll: true })
		} else if (reconciled.outsideFocus) {
			detailContent.querySelector<HTMLElement>(`[data-live-focus="${CSS.escape(reconciled.outsideFocus)}"]`)?.focus({ preventScroll: true })
		}
	}

	const stagedAccountDialogSnapshot = (canonicalRecovery: boolean, stagedLiveRefresh: boolean, restoreSnapshot: DialogSnapshot | undefined) => {
		if (canonicalRecovery) return restoreSnapshot
		return stagedLiveRefresh ? captureAccountDialogSnapshot() : undefined
	}

	const performOpenAccountTransactions = createAccountTransactionLoader({
		...deps.loaderDeps,
		stagedAccountDialogSnapshot,
		restoreAccountDialogSnapshot,
		captureAccountDialogSnapshot,
		restorePendingCanonicalAccount: () => restorePendingCanonicalAccount(),
		openAccountTransactions: (account, options) => openAccountTransactions(account, options),
	})

	const openAccountTransactions = (account: AccountReference, options: AccountDetailOptions = {}): Promise<boolean> => {
		if (options.live !== true && options.canonicalRecovery !== true) {
			activityDetailState.detailContextVersion++
			activityDetailState.detailRequestVersion++
		}
		const contextVersion = activityDetailState.detailContextVersion
		const operation = () => performOpenAccountTransactions(account, { ...options, contextVersion })
		return options.live === true ? detailRefreshGate.runBackground(operation) : detailRefreshGate.runForeground(operation)
	}

	const restorePendingCanonicalAccount = async () => {
		const pending = activityDetailState.pendingCanonicalAccount
		if (pending === undefined) return true
		let restored = false
		const profile = deps.getAddressProfile()
		if (deps.getIsRichList()) {
			const current = deps.getRichListItems().find(item => String(item.chain_id) === String(pending.chain_id) && item.address.toLowerCase() === pending.address.toLowerCase())
			restored = await openAccountTransactions(current ?? pending, {
				live: dialog.open,
				restoreSnapshot: activityDetailState.pendingAccountDialogSnapshot,
				canonicalRecovery: true,
			})
		} else if (deps.getIsAddress() && profile && String(profile.chain_id) === String(pending.chain_id) && profile.address.toLowerCase() === pending.address.toLowerCase())
			restored = await openAccountTransactions(profile, {
				live: dialog.open,
				restoreSnapshot: activityDetailState.pendingAccountDialogSnapshot,
				canonicalRecovery: true,
			})
		if (restored) {
			activityDetailState.pendingCanonicalAccount = undefined
			activityDetailState.pendingAccountDialogSnapshot = undefined
		}
		return restored
	}

	const closeDetail = ({ preservePendingCanonicalAccount = false, preservePendingCanonicalLog = false } = {}) => {
		activityDetailState.detailContextVersion++
		activityDetailState.detailRequestVersion++
		activityDetailState.activeLog = undefined
		removeEventDrawers()
		activityDetailState.activeAccount = undefined
		activityDetailState.activeAccountTransactions = undefined
		activityDetailState.activeAccountLoadMore = undefined
		if (canonicalState.recovery !== undefined) {
			canonicalState.recovery.logToRefresh = undefined
			canonicalState.recovery.accountToRefresh = undefined
		}
		hideCanonicalDialogStatus()
		activityDetailState.preservePendingOnDialogClose = preservePendingCanonicalAccount || preservePendingCanonicalLog
		if (!preservePendingCanonicalAccount) {
			activityDetailState.pendingCanonicalAccount = undefined
			activityDetailState.pendingAccountDialogSnapshot = undefined
		}
		if (!preservePendingCanonicalLog) activityDetailState.pendingCanonicalLog = undefined
		dialog.close()
		clearDetailUrl()
	}

	const clearDetailUrl = () => {
		const url = urlWithoutLogDetail(new URL(location.href))
		url.searchParams.delete('account')
		history.replaceState(null, '', url)
	}

	return { captureAccountDialogSnapshot, openAccountTransactions, restorePendingCanonicalAccount, closeDetail, clearDetailUrl }
}
