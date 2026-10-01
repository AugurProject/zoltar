export const refreshPresentation = ({ live, append = false }: { live: boolean; append?: boolean }): { busy: boolean; loadingState: boolean } => {
	const visible = !live || append
	return { busy: visible, loadingState: visible }
}

export const resolveActivityRefreshDepth = (...depths: Array<number | undefined>): number | undefined => {
	const targetDepth = Math.max(0, ...depths.filter((depth): depth is number => depth !== undefined && Number.isInteger(depth) && depth > 0))
	return targetDepth > 0 ? targetDepth : undefined
}

export const activityRefreshRetention = (canonicalRefreshRequired: boolean, canonicalDepth: number | undefined, visibleDepth: number) => ({
	replaceDepth: resolveActivityRefreshDepth(canonicalRefreshRequired ? canonicalDepth : undefined, visibleDepth),
	retainVisibleDepth: true,
})

export const retainedPaginationAvailable = (hasContinuation: boolean, canonicalRefreshRequired: boolean): boolean => hasContinuation && !canonicalRefreshRequired

export const paginationRequestAllowed = (append: boolean, canonicalRefreshRequired: boolean): boolean => !append || !canonicalRefreshRequired

export const queuedPaginationPresentation = (canonicalRefreshRequired: boolean) => ({
	hidden: canonicalRefreshRequired,
	disabled: true,
	busy: !canonicalRefreshRequired,
	label: canonicalRefreshRequired ? 'Show more' : 'Loading more…',
})

export const entityHistoryContinuationPresentation = (state: 'pending' | 'error') =>
	state === 'pending'
		? {
				buttonLabel: 'Showing older history…',
				statusText: 'Loading older historical records…',
				statusVisuallyHidden: true,
			}
		: {
				buttonLabel: 'Retry older history',
				statusText: 'Older historical records could not be loaded.',
				statusVisuallyHidden: false,
			}

export const transactionRetryMode = (appendFailure: boolean, hasLoadedTransactions: boolean) => ({
	append: appendFailure,
	liveRefresh: !appendFailure && hasLoadedTransactions,
})

export const accountStateDuringStagedRefresh = <T>(committedState: T, stagedState: T, stagedRefresh: boolean): T => (stagedRefresh ? committedState : stagedState)

export const isNoncanonicalDetailFailure = (canonicalRecovery: boolean, status?: number): boolean => canonicalRecovery && status === 404

export const shouldClearPendingDetailState = (preservePendingOnClose: boolean): boolean => !preservePendingOnClose

export const shouldContinueTransactionRestore = (loaded: boolean, loadedCount: number, targetLoadedCount: number, nextPageCursor?: string) => loaded && loadedCount < targetLoadedCount && nextPageCursor !== undefined
