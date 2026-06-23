type LocalSettlementBidStatus = 'claimed' | 'refunded'

export type TruthAuctionSettlementAction = 'claimAuctionProceeds' | 'refundLosingBids'

type TruthAuctionSettlementPendingAction = {
	action: TruthAuctionSettlementAction
	claimKeys: string[]
	ignoredResultHash: string | undefined
	refundKeys: string[]
}

export type TruthAuctionSettlementActionState = {
	pendingAction: TruthAuctionSettlementPendingAction | undefined
	refreshToken: number
	resultByKey: Record<string, LocalSettlementBidStatus>
	selectedBidKeys: string[]
}

export type TruthAuctionSettlementActionStateEvent =
	| { type: 'reset' }
	| { type: 'selectBidKeys'; selectedBidKeys: string[] }
	| { type: 'submit'; action: TruthAuctionSettlementAction; claimKeys: string[]; ignoredResultHash: string | undefined; refundKeys: string[] }
	| { type: 'transactionFailed' }
	| { type: 'transactionSucceeded'; action: TruthAuctionSettlementAction }
	| { type: 'pruneUnavailableBids'; availableBidKeys: string[] }

export function createTruthAuctionSettlementActionState(): TruthAuctionSettlementActionState {
	return {
		pendingAction: undefined,
		refreshToken: 0,
		resultByKey: {},
		selectedBidKeys: [],
	}
}

function uniqueKeys(keys: string[]) {
	return Array.from(new Set(keys))
}

function sameStringArray(left: string[], right: string[]) {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

function removeKeys(keys: string[], keysToRemove: string[]) {
	if (keys.length === 0 || keysToRemove.length === 0) return keys
	const removedKeySet = new Set(keysToRemove)
	const nextKeys = keys.filter(key => !removedKeySet.has(key))
	return sameStringArray(nextKeys, keys) ? keys : nextKeys
}

function filterKeys(keys: string[], availableBidKeySet: Set<string>) {
	if (keys.length === 0) return keys
	const nextKeys = keys.filter(key => availableBidKeySet.has(key))
	return sameStringArray(nextKeys, keys) ? keys : nextKeys
}

function markSettlementBidResults(state: TruthAuctionSettlementActionState, bidKeys: string[], status: LocalSettlementBidStatus) {
	const targetBidKeys = uniqueKeys(bidKeys)
	if (targetBidKeys.length === 0) return state

	const nextResultByKey = { ...state.resultByKey }
	for (const bidKey of targetBidKeys) {
		nextResultByKey[bidKey] = status
	}

	return {
		...state,
		resultByKey: nextResultByKey,
		selectedBidKeys: removeKeys(state.selectedBidKeys, targetBidKeys),
	}
}

function filterResultStatuses(resultByKey: Record<string, LocalSettlementBidStatus>, availableBidKeySet: Set<string>) {
	const nextResultByKey: Record<string, LocalSettlementBidStatus> = {}
	let changed = false

	for (const [key, status] of Object.entries(resultByKey)) {
		if (!availableBidKeySet.has(key)) {
			changed = true
			continue
		}
		nextResultByKey[key] = status
	}

	if (!changed) return resultByKey
	return nextResultByKey
}

function prunePendingAction(pendingAction: TruthAuctionSettlementPendingAction | undefined, availableBidKeySet: Set<string>) {
	if (pendingAction === undefined) return undefined

	const claimKeys = filterKeys(pendingAction.claimKeys, availableBidKeySet)
	const refundKeys = filterKeys(pendingAction.refundKeys, availableBidKeySet)
	if (claimKeys.length === 0 && refundKeys.length === 0) return undefined
	if (claimKeys === pendingAction.claimKeys && refundKeys === pendingAction.refundKeys) return pendingAction

	return {
		...pendingAction,
		claimKeys,
		refundKeys,
	}
}

export function reduceTruthAuctionSettlementActionState(state: TruthAuctionSettlementActionState, event: TruthAuctionSettlementActionStateEvent): TruthAuctionSettlementActionState {
	switch (event.type) {
		case 'reset':
			if (state.pendingAction === undefined && state.selectedBidKeys.length === 0 && Object.keys(state.resultByKey).length === 0) return state
			return {
				...createTruthAuctionSettlementActionState(),
				refreshToken: state.refreshToken,
			}
		case 'selectBidKeys': {
			const selectedBidKeys = uniqueKeys(event.selectedBidKeys)
			if (sameStringArray(state.selectedBidKeys, selectedBidKeys)) return state
			return {
				...state,
				selectedBidKeys,
			}
		}
		case 'submit': {
			const claimKeys = uniqueKeys(event.claimKeys)
			const refundKeys = uniqueKeys(event.refundKeys)
			if (claimKeys.length === 0 && refundKeys.length === 0) return state
			return {
				...state,
				pendingAction: {
					action: event.action,
					claimKeys,
					ignoredResultHash: event.ignoredResultHash,
					refundKeys,
				},
			}
		}
		case 'transactionFailed':
			if (state.pendingAction === undefined) return state
			return {
				...state,
				pendingAction: undefined,
			}
		case 'transactionSucceeded': {
			const pendingAction = state.pendingAction
			if (pendingAction === undefined || pendingAction.action !== event.action) return state

			const nextState = event.action === 'claimAuctionProceeds' ? markSettlementBidResults(markSettlementBidResults(state, pendingAction.claimKeys, 'claimed'), pendingAction.refundKeys, 'refunded') : markSettlementBidResults(state, pendingAction.refundKeys, 'refunded')

			return {
				...nextState,
				pendingAction: undefined,
				refreshToken: nextState.refreshToken + 1,
			}
		}
		case 'pruneUnavailableBids': {
			const availableBidKeySet = new Set(event.availableBidKeys)
			const selectedBidKeys = filterKeys(state.selectedBidKeys, availableBidKeySet)
			const pendingAction = prunePendingAction(state.pendingAction, availableBidKeySet)
			const resultByKey = filterResultStatuses(state.resultByKey, availableBidKeySet)
			if (selectedBidKeys === state.selectedBidKeys && pendingAction === state.pendingAction && resultByKey === state.resultByKey) return state
			return {
				...state,
				pendingAction,
				resultByKey,
				selectedBidKeys,
			}
		}
		default:
			return state
	}
}
