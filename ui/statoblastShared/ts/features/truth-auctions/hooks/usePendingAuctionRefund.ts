import { useEffect } from 'preact/hooks'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../../../contractArtifact.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import type { useForkAuctionContext } from './useForkAuctionContext.js'

type PendingAuctionRefundContext = Pick<
	ReturnType<typeof useForkAuctionContext>,
	'accountState' | 'auctionTruthAuctionAddress' | 'setPendingEthRefundAttoEth' | 'setLoadingPendingEthRefund' | 'setPendingEthRefundError' | 'truthAuctionReadClient' | 'forkAuctionResult' | 'pendingEthRefundRetryNonce' | 'selectedPoolRefreshNonce'
>

export function usePendingAuctionRefund(context: PendingAuctionRefundContext) {
	useEffect(() => {
		let canceled = false
		if (context.accountState.address === undefined || context.auctionTruthAuctionAddress === undefined || context.auctionTruthAuctionAddress === zeroAddress) {
			context.setPendingEthRefundAttoEth(undefined)
			context.setLoadingPendingEthRefund(false)
			context.setPendingEthRefundError(undefined)
			return
		}
		context.setPendingEthRefundAttoEth(undefined)
		context.setLoadingPendingEthRefund(true)
		context.setPendingEthRefundError(undefined)
		const client = context.truthAuctionReadClient ?? createConnectedReadClient()
		void client
			.readContract({
				address: context.auctionTruthAuctionAddress,
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'pendingEthRefundsAttoEth',
				args: [context.accountState.address],
			})
			.then(value => {
				if (canceled) return
				if (typeof value !== 'bigint') throw new Error('Pending refund response was not a bigint')
				context.setPendingEthRefundAttoEth(value)
			})
			.catch(() => {
				if (!canceled) context.setPendingEthRefundError(forkAuctionCopy.pendingRefundUnavailable)
			})
			.finally(() => {
				if (!canceled) context.setLoadingPendingEthRefund(false)
			})
		return () => {
			canceled = true
		}
	}, [context.accountState.address, context.auctionTruthAuctionAddress, context.forkAuctionResult?.hash, context.pendingEthRefundRetryNonce, context.selectedPoolRefreshNonce, context.truthAuctionReadClient])
}
