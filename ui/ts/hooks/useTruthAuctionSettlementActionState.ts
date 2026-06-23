import { useEffect, useState } from 'preact/hooks'
import type { Address } from 'viem'
import { sameAddress } from '../lib/address.js'
import { createTruthAuctionSettlementActionState, reduceTruthAuctionSettlementActionState, type TruthAuctionSettlementAction } from '../lib/truthAuctionSettlementActionState.js'
import { getTruthAuctionSettlementBidKey, getTruthAuctionSettlementSelectionState, type TruthAuctionSettlementBidRow } from '../lib/truthAuctionSettlement.js'
import type { ForkWorkflowSelectionStage } from '../lib/securityPoolWorkflow.js'
import type { ForkAuctionActionResult } from '../types/contracts.js'
import type { SettlementSelectedBid } from '../types/components.js'

type SettlementBidKeyUpdater = string[] | ((currentKeys: string[]) => string[])

type UseTruthAuctionSettlementActionStateParams = {
	accountAddress: Address | undefined
	forkAuctionError: string | undefined
	forkAuctionResult: ForkAuctionActionResult | undefined
	onClaimAuctionProceeds: (securityPoolAddressOverride?: Address, selectedClaimBids?: readonly SettlementSelectedBid[], selectedRefundBids?: readonly SettlementSelectedBid[]) => void
	onRefundLosingBids: (securityPoolAddressOverride?: Address, selectedBids?: readonly SettlementSelectedBid[]) => void
	selectedAuctionPoolAddress: Address | undefined
	selectedStage: ForkWorkflowSelectionStage
	settlementBidRows: TruthAuctionSettlementBidRow[]
}

function getSettlementBidsFromKeys(settlementBidRows: TruthAuctionSettlementBidRow[], selectedBidKeys: string[]) {
	const selectedBidKeySet = new Set(selectedBidKeys)
	return settlementBidRows.filter(({ bid }) => selectedBidKeySet.has(getTruthAuctionSettlementBidKey(bid))).map(({ bid }) => ({ bidIndex: bid.bidIndex, tick: bid.tick }))
}

function getSettlementAction(claimKeys: string[], refundKeys: string[]): TruthAuctionSettlementAction | undefined {
	if (claimKeys.length > 0) return 'claimAuctionProceeds'
	if (refundKeys.length > 0) return 'refundLosingBids'
	return undefined
}

function resolveSettlementBidKeyUpdate(currentKeys: string[], update: SettlementBidKeyUpdater) {
	if (typeof update === 'function') return update(currentKeys)
	return update
}

export function useTruthAuctionSettlementActionState({ accountAddress, forkAuctionError, forkAuctionResult, onClaimAuctionProceeds, onRefundLosingBids, selectedAuctionPoolAddress, selectedStage, settlementBidRows }: UseTruthAuctionSettlementActionStateParams) {
	const [settlementActionState, setSettlementActionState] = useState(createTruthAuctionSettlementActionState)
	const settlementSelectionState = getTruthAuctionSettlementSelectionState({
		selectedBidKeys: settlementActionState.selectedBidKeys,
		settlementBidRows,
	})
	const settlementBidRowKeys = settlementSelectionState.rowKeys
	const settlementBidRowKeySignature = settlementBidRowKeys.slice().sort().join('\u0000')
	const isSettleSelectedBidsInProgress = settlementActionState.pendingAction !== undefined
	const dispatchSettlementActionState = (event: Parameters<typeof reduceTruthAuctionSettlementActionState>[1]) => {
		setSettlementActionState(currentState => reduceTruthAuctionSettlementActionState(currentState, event))
	}
	const setSelectedSettlementBidKeys = (update: SettlementBidKeyUpdater) => {
		setSettlementActionState(currentState =>
			reduceTruthAuctionSettlementActionState(currentState, {
				selectedBidKeys: resolveSettlementBidKeyUpdate(currentState.selectedBidKeys, update),
				type: 'selectBidKeys',
			}),
		)
	}
	const submitClaimBidsByKeys = (claimBidKeys: string[]) => {
		if (selectedAuctionPoolAddress === undefined || isSettleSelectedBidsInProgress) return
		const claimBids = getSettlementBidsFromKeys(settlementBidRows, claimBidKeys)
		if (claimBids.length === 0) return
		dispatchSettlementActionState({
			action: 'claimAuctionProceeds',
			claimKeys: claimBidKeys,
			ignoredResultHash: forkAuctionResult?.hash,
			refundKeys: [],
			type: 'submit',
		})
		onClaimAuctionProceeds(selectedAuctionPoolAddress, claimBids)
	}
	const submitRefundBidsByKeys = (refundBidKeys: string[]) => {
		if (selectedAuctionPoolAddress === undefined || isSettleSelectedBidsInProgress) return
		const refundBids = getSettlementBidsFromKeys(settlementBidRows, refundBidKeys)
		if (refundBids.length === 0) return
		dispatchSettlementActionState({
			action: 'refundLosingBids',
			claimKeys: [],
			ignoredResultHash: forkAuctionResult?.hash,
			refundKeys: refundBidKeys,
			type: 'submit',
		})
		onRefundLosingBids(selectedAuctionPoolAddress, refundBids)
	}
	const submitSelectedSettlementBids = () => {
		if (settlementSelectionState.selectedRows.length === 0) return
		if (isSettleSelectedBidsInProgress) return
		if (selectedAuctionPoolAddress === undefined) return
		const selectedClaimSettlementBids = getSettlementBidsFromKeys(settlementBidRows, settlementSelectionState.selectedClaimKeys)
		const selectedRefundSettlementBids = getSettlementBidsFromKeys(settlementBidRows, settlementSelectionState.selectedRefundKeys)
		const settlementAction = getSettlementAction(settlementSelectionState.selectedClaimKeys, settlementSelectionState.selectedRefundKeys)
		if (settlementAction === undefined) return

		dispatchSettlementActionState({
			action: settlementAction,
			claimKeys: settlementSelectionState.selectedClaimKeys,
			ignoredResultHash: forkAuctionResult?.hash,
			refundKeys: settlementSelectionState.selectedRefundKeys,
			type: 'submit',
		})
		if (settlementAction === 'claimAuctionProceeds') {
			onClaimAuctionProceeds(selectedAuctionPoolAddress, selectedClaimSettlementBids, selectedRefundSettlementBids)
			return
		}
		onRefundLosingBids(selectedAuctionPoolAddress, selectedRefundSettlementBids)
	}

	useEffect(() => {
		const pendingAction = settlementActionState.pendingAction
		if (pendingAction === undefined) return
		if (forkAuctionError !== undefined) {
			dispatchSettlementActionState({ type: 'transactionFailed' })
			return
		}
		if (forkAuctionResult === undefined || selectedAuctionPoolAddress === undefined || !sameAddress(forkAuctionResult.securityPoolAddress, selectedAuctionPoolAddress)) return
		if (pendingAction.ignoredResultHash !== undefined && forkAuctionResult.hash === pendingAction.ignoredResultHash) return
		if (forkAuctionResult.action !== pendingAction.action) return
		dispatchSettlementActionState({
			action: pendingAction.action,
			type: 'transactionSucceeded',
		})
	}, [forkAuctionError, forkAuctionResult, settlementActionState.pendingAction, selectedAuctionPoolAddress])

	useEffect(() => {
		if (selectedStage !== 'settlement') {
			dispatchSettlementActionState({ type: 'reset' })
			return
		}
		dispatchSettlementActionState({
			availableBidKeys: settlementBidRowKeys,
			type: 'pruneUnavailableBids',
		})
	}, [accountAddress, selectedStage, settlementBidRowKeySignature, selectedAuctionPoolAddress])

	return {
		isSettleSelectedBidsInProgress,
		selectedSettlementBidKeys: settlementActionState.selectedBidKeys,
		setSelectedSettlementBidKeys,
		settlementBidResultByKey: settlementActionState.resultByKey,
		settlementBidResultRefreshToken: settlementActionState.refreshToken,
		settlementSelectionState,
		submitClaimBidsByKeys,
		submitRefundBidsByKeys,
		submitSelectedSettlementBids,
	}
}
