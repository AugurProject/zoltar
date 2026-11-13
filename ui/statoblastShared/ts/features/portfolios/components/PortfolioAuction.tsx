import * as collateralCopy from '../../../copy/collateral.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { tokenRequiresAllowanceReset } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { PortfolioButton, PortfolioInput } from './PortfolioControls.js'
import { usePortfolioAuction, type PortfolioAuctionParameters } from '../hooks/usePortfolioAuction.js'
import { useId } from 'preact/hooks'
import { InlineHint } from '@zoltar/ui-core-shared/components/InlineHint.js'
import type { PortfolioAuctionBid } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import * as copy from '../../../copy/portfolioAuction.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

export function PortfolioAuction(parameters: PortfolioAuctionParameters) {
	const model = usePortfolioAuction(parameters)
	const snapshot = model.snapshot
	const auction = snapshot?.auction
	const disabled = parameters.actions.busy !== undefined
	let status = copy.states.unopened
	if (auction?.opened) status = copy.states.bidding
	if (snapshot !== undefined && auction !== undefined && snapshot.timestamp >= auction.closesAt) status = copy.states.waiting
	if (auction?.finalized) status = copy.states.finalized
	const refreshReason = (disabled ? copy.busy : undefined) ?? (model.loading ? copy.loading : undefined) ?? (parameters.bidder === undefined ? copy.connect : undefined) ?? (parameters.fork?.branch === undefined ? copy.selectBranch : undefined)
	return (
		<WorkflowSubsection title={copy.title}>
			<UserMessage detail={copy.description} />
			{model.error === undefined ? undefined : <UserMessage tone='error' detail={model.error} />}
			<MetricGrid>
				<MetricField label={copy.status} loading={model.loading}>
					{auction === undefined ? undefined : status}
				</MetricField>
				<MetricField label={copy.closes}>
					<TimestampValue timestamp={auction?.closesAt} relative={false} />
				</MetricField>
				<MetricField label={copy.inventory} loading={model.loading}>
					<CurrencyValue value={auction?.inventoryAttoRep} suffix={common.rep} />
				</MetricField>
				<MetricField label={copy.shortfall} loading={model.loading}>
					<CurrencyValue value={auction?.shortfallAttoEth} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
				</MetricField>
			</MetricGrid>
			<PortfolioButton model={parameters.actions} action='openPortfolioAuction' label={copy.open} pendingLabel={copy.opening} reason={model.openReason} onClick={model.open} />
			<MetricGrid>
				<MetricField label={copy.lotPrice} loading={model.loading}>
					<CurrencyValue value={auction?.lotAttoEth} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
				</MetricField>
				<MetricField label={copy.minimumCollateral} loading={model.loading}>
					<CurrencyValue value={auction?.opened ? auction.minimumCollateralAttoRepPerLot : undefined} suffix={common.rep} />
				</MetricField>
				<MetricField label={copy.clearingRep} loading={model.loading}>
					<CurrencyValue value={auction?.clearing?.attoRepPerLot} suffix={common.rep} />
				</MetricField>
			</MetricGrid>
			<MetricGrid>
				<PortfolioInput label={copy.lotCount} hint={copy.lotHint} value={model.lotsInput} onChange={model.setLots} disabled={disabled} />
				<PortfolioInput label={copy.minimumRep} hint={copy.priceHint(auction?.repGrid)} value={model.repInput} onChange={model.setRep} disabled={disabled} numeric />
				<PortfolioInput label={copy.health} value={model.healthInput} onChange={model.setHealth} disabled={disabled} numeric />
			</MetricGrid>
			<MetricGrid>
				<MetricField label={copy.bidEth}>
					<CurrencyValue value={model.quote?.bidAttoEth} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
				</MetricField>
				<MetricField label={copy.minimumPrincipal}>
					<CurrencyValue value={model.quote?.minimumPrincipalAttoRep} suffix={common.rep} />
				</MetricField>
			</MetricGrid>
			<UserMessage tone='warning' detail={copy.ownership} />
			<UserMessage detail={copy.fairness} />
			{snapshot !== undefined && tokenRequiresAllowanceReset(snapshot.collateralToken) ? (
				<PortfolioButton model={parameters.actions} action='resetAuctionCollateral' label={collateralCopy.reset} pendingLabel={collateralCopy.resetting} reason={model.fundingReason ?? (snapshot.collateralAllowance === 0n ? collateralCopy.notNeeded : undefined)} onClick={() => model.approve(0n)} />
			) : undefined}

			<TokenApprovalControl
				actionLabel={copy.bid}
				allowanceError={model.error}
				allowanceLoading={model.loading}
				approvedAmount={snapshot?.collateralAllowance}
				disabled={disabled}
				guardMessage={model.fundingReason}
				requiresAllowanceReset={tokenRequiresAllowanceReset(snapshot?.collateralToken)}
				onApprove={amount => {
					if (amount !== undefined) void model.approve(amount)
				}}
				pending={parameters.actions.busy === 'approveAuctionCollateral'}
				pendingLabel={collateralCopy.approving}
				requiredAmount={model.quote?.bidAttoEth}
				resetKey={`${snapshot?.auction?.address}:${parameters.bidder}:${model.quote?.bidAttoEth}`}
				tokenSymbol={snapshot?.collateral.symbol ?? collateralCopy.fallback}
				tokenUnits={snapshot?.collateral.decimals ?? 18}
			/>
			<PortfolioButton model={parameters.actions} action='bidPortfolioAuction' label={copy.bid} pendingLabel={copy.bidding} reason={model.bidReason} onClick={model.bid} />
			<h4>{copy.yourBids}</h4>
			{auction?.bids.length === 0 && !model.loading ? <EmptyState title={copy.noBids} /> : undefined}
			{auction?.bids.map(bid => {
				let bidStatus = copy.awaitingClose
				if (bid.earlyRefundAttoEth > 0n) bidStatus = copy.earlyRefundAvailable
				if (!auction.finalized && bid.refundSettled) bidStatus = auction.refundAttoEth === 0n ? copy.earlyRefundWithdrawn : copy.earlyRefundCredited
				if (bid.fill !== undefined) bidStatus = bid.fill.filledLots > 0n ? copy.funded : copy.noFill
				let refundAttoEth = bid.earlyRefundAttoEth > 0n ? bid.earlyRefundAttoEth : undefined
				if (bid.refundSettled) refundAttoEth = bid.lots * auction.lotAttoEth
				if (bid.fill !== undefined) refundAttoEth = bid.fill.refundAttoEth
				const manageReason =
					(disabled ? copy.busy : undefined) ?? (model.loading ? copy.loading : undefined) ?? (bid.fill === undefined || bid.fill.filledLots === 0n ? copy.managePending : undefined) ?? (!bid.materialized ? copy.activateFirst : undefined) ?? (parameters.openVault === undefined ? copy.manageUnavailable : undefined)
				return (
					<article key={bid.id.toString()}>
						<h5>{copy.bidLabel(bid.id)}</h5>
						<UserMessage detail={bidStatus} />
						<MetricGrid>
							<MetricField label={copy.vault}>
								<AddressValue address={bid.vault} />
							</MetricField>
							<MetricField label={copy.requestedLots}>{bid.lots.toString()}</MetricField>
							<MetricField label={copy.filledLots}>{bid.fill?.filledLots.toString()}</MetricField>
							<MetricField label={copy.principal}>
								<CurrencyValue value={bid.position?.principalAttoRep} suffix={common.rep} />
							</MetricField>
							<MetricField label={copy.commitment}>
								<CurrencyValue value={bid.position?.commitmentAttoEth} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
							</MetricField>
							<MetricField label={copy.earnedEth}>
								<CurrencyValue value={bid.position?.earnedAttoEth} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
							</MetricField>
							<MetricField label={copy.earnedRep}>
								<CurrencyValue value={bid.position?.earnedAttoRep} suffix={common.rep} />
							</MetricField>
							<MetricField label={copy.purchasedPrincipal}>
								<CurrencyValue value={bid.fill?.principalAttoRep} suffix={common.rep} />
							</MetricField>
							<MetricField label={copy.charged}>
								<CurrencyValue value={bid.fill?.usedAttoEth} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
							</MetricField>
							<MetricField label={copy.refund}>
								<CurrencyValue value={refundAttoEth} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
							</MetricField>
						</MetricGrid>
						<RefundActions model={model} actions={parameters.actions} bid={bid} />
						<div className='actions'>
							<PortfolioButton model={parameters.actions} action={`activatePortfolioAuction${bid.id}`} label={copy.activate} pendingLabel={copy.activating} reason={model.activateReason(bid)} onClick={() => model.activate(bid)} />
							<ActionLauncherButton
								tone='secondary'
								idleLabel={copy.manage}
								pendingLabel={copy.loading}
								availability={{ disabled: manageReason !== undefined, reason: manageReason }}
								onClick={() => {
									if (snapshot !== undefined) parameters.openVault?.(bid.vault, snapshot.universeId)
								}}
							/>
						</div>
						{bid.fill !== undefined && bid.fill.filledLots > 0n && !bid.materialized && <UserMessage detail={copy.activateHint} />}
					</article>
				)
			})}
			<PaginationControls
				hasPreviousPage={(auction?.bidStart ?? 0n) > 0n}
				hasNextPage={auction !== undefined && auction.bidStart + BigInt(auction.bids.length) < auction.totalBidCount}
				loading={model.loading}
				onPreviousPage={model.previousPage}
				onNextPage={model.nextPage}
				summary={auction === undefined ? undefined : copy.pages(auction.bidStart, auction.bids.length, auction.totalBidCount)}
			/>
			<MetricGrid>
				<MetricField label={copy.refundEth}>
					<CurrencyValue value={auction?.refundAttoEth} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
				</MetricField>
			</MetricGrid>
			<div className='actions'>
				<PortfolioButton model={parameters.actions} action='withdrawPortfolioAuction' label={copy.withdraw} pendingLabel={copy.withdrawing} reason={model.withdrawalReason} onClick={model.withdraw} />
				<ActionLauncherButton tone='secondary' idleLabel={copy.refresh} pendingLabel={copy.refreshing} availability={{ disabled: refreshReason !== undefined, reason: refreshReason }} onClick={model.refresh} />
			</div>
		</WorkflowSubsection>
	)
}

/** The two refund actions often rest disabled for one shared cause, such as a bid that may still win; that reason renders once for the pair. */
function RefundActions({ model, actions, bid }: { model: ReturnType<typeof usePortfolioAuction>; actions: PortfolioAuctionParameters['actions']; bid: PortfolioAuctionBid }) {
	const sharedReasonId = useId()
	const creditReason = model.refundReason(bid)
	const claimReason = model.claimReason(bid)
	const sharedReason = actions.busy === undefined && creditReason !== undefined && creditReason === claimReason ? creditReason : undefined
	const reasonId = sharedReason === undefined ? undefined : sharedReasonId
	return (
		<>
			<div className='actions'>
				<PortfolioButton model={actions} action={`creditPortfolioAuction${bid.id}`} label={copy.credit} pendingLabel={copy.crediting} reason={creditReason} sharedReasonId={reasonId} onClick={() => model.credit(bid)} />
				<PortfolioButton model={actions} action={`claimPortfolioAuction${bid.id}`} label={copy.claim} pendingLabel={copy.claiming} reason={claimReason} sharedReasonId={reasonId} onClick={() => model.claim(bid)} />
			</div>
			{sharedReason === undefined ? undefined : (
				<div className='tx-action-feedback shared-action-reason'>
					<InlineHint id={sharedReasonId} message={sharedReason} />
				</div>
			)}
		</>
	)
}
