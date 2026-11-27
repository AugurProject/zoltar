import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import * as collateralCopy from '../../../copy/collateral.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { SecurityPoolButton, SecurityPoolInput } from './SecurityPoolControls.js'
import { useSecurityPoolAuction, type SecurityPoolAuctionParameters } from '../hooks/useSecurityPoolAuction.js'
import { useSecurityPoolDeadline } from '../hooks/useSecurityPoolDeadline.js'
import { useEffect } from 'preact/hooks'
import type { SecurityPoolAuctionBid } from '@zoltar/statoblast-shared/statoblast/securityPool'
import * as copy from '../../../copy/securityPoolRepairAuction.js'
import { deadlineChecking } from '../../../copy/questionPage.js'
import { tryAgain } from '../../../copy/securityPoolPage.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import { useOldActionDataNotice } from '../../useStatoblastPageRefresh.js'
import { formatCurrencyBalance, formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'

type AuctionModel = ReturnType<typeof useSecurityPoolAuction>
type Auction = NonNullable<NonNullable<AuctionModel['snapshot']>['auction']>
type Collateral = Pick<NonNullable<AuctionModel['snapshot']>['collateral'], 'symbol' | 'decimals'>

export function SecurityPoolRepairAuction({ onAuctionFinalized, sharedDeadline = false, sharedDeadlineChecking = false, ...parameters }: SecurityPoolAuctionParameters & { onAuctionFinalized?: ((universeId: bigint) => void) | undefined; sharedDeadline?: boolean; sharedDeadlineChecking?: boolean }) {
	const model = useSecurityPoolAuction(parameters)
	const snapshot = model.snapshot
	const actionDataNotice = useOldActionDataNotice(sharedDeadline ? model.displayedAt : undefined)
	const loadingDetails = model.loading && snapshot === undefined
	const auction = snapshot?.auction
	const childUniverse = parameters.fork?.branch?.universeId
	useEffect(() => {
		if (childUniverse !== undefined && auction?.finalized) onAuctionFinalized?.(childUniverse)
	}, [childUniverse, auction?.finalized, onAuctionFinalized])
	const disabled = parameters.actions.busy !== undefined
	const deadline = parameters.fork?.activationDeadline
	const closesAt = deadline !== undefined && deadline > 0n ? deadline : auction?.closesAt
	const check = useSecurityPoolDeadline({
		scope: `${parameters.fork?.chainId}:${auction?.address}:${parameters.bidder}`,
		deadline: sharedDeadline || auction === undefined || auction.finalized ? undefined : closesAt,
		timestamp: snapshot?.timestamp,
		readAt: model.displayedAt,
		reading: model.loading || parameters.fork?.branch === undefined || parameters.bidder === undefined,
		refresh: model.refresh,
	})
	const checking = sharedDeadlineChecking || check.checking
	let checkedTime = snapshot?.timestamp
	if (sharedDeadline && parameters.fork !== undefined && (checkedTime === undefined || parameters.fork.timestamp > checkedTime)) checkedTime = parameters.fork.timestamp
	const closed = checkedTime !== undefined && closesAt !== undefined && checkedTime >= closesAt
	let deadlineReason = closed ? copy.closed : undefined
	if (checking) deadlineReason = deadlineChecking
	const isOpen = !checking && !closed && auction?.opened === true && !auction.finalized && snapshot !== undefined
	const noSale = auction?.finalized === true && auction.shortfallAttoEth > 0n && (!auction.opened || auction.clearing?.filledLots === 0n)
	const highest = isOpen && auction.maximumAdmissibleBidAttoRepPerLot >= auction.minimumCollateralAttoRepPerLot ? auction.maximumAdmissibleBidAttoRepPerLot : undefined
	let askHint = copy.priceHint(auction?.repGrid)
	if (highest !== undefined && auction !== undefined) askHint = copy.askRange(formatCurrencyBalance(auction.minimumCollateralAttoRepPerLot), formatCurrencyBalance(highest))
	const collateral = snapshot?.collateral ?? { symbol: collateralCopy.fallback, decimals: 18 }
	const collateralAmount = (amount: bigint | undefined) => <CurrencyValue value={amount} suffix={collateral.symbol} units={collateral.decimals} />
	let status = copy.states.unopened
	if (auction?.opened) status = copy.states.bidding
	if (closed) status = copy.states.waiting
	if (checking) status = deadlineChecking
	if (auction?.finalized) status = copy.states.finalized
	const refreshReason = (disabled ? copy.busy : undefined) ?? (model.loading ? copy.loading : undefined) ?? (parameters.bidder === undefined ? copy.connect : undefined) ?? (parameters.fork?.branch === undefined ? copy.selectBranch : undefined)
	return (
		<WorkflowSubsection title={copy.title}>
			{actionDataNotice !== undefined && <p className='detail'>{actionDataNotice}</p>}
			<UserMessage detail={copy.description} />
			<RetryableNotice message={model.error ?? (check.failed ? deadlineChecking : undefined)} retryLabel={tryAgain} onRetry={check.failed ? check.retry : model.refresh} />
			{model.savedAt !== undefined && (
				<p className='detail'>
					{copy.savedBids} <UpdatedAgo updatedAt={model.savedAt} />
				</p>
			)}
			<MetricGrid>
				<MetricField label={copy.status} loading={loadingDetails}>
					{auction === undefined ? undefined : status}
				</MetricField>
				{!sharedDeadline && (
					<MetricField label={copy.recapitalizationDeadline}>
						<TimestampValue timestamp={closesAt} {...(snapshot === undefined ? {} : { currentTimestamp: snapshot.timestamp })} />
					</MetricField>
				)}
				<MetricField label={copy.inventory} loading={loadingDetails}>
					<CurrencyValue value={auction?.inventoryAttoRep} suffix={common.rep} />
				</MetricField>
				<MetricField label={copy.shortfall} loading={loadingDetails}>
					{collateralAmount(auction?.shortfallAttoEth)}
				</MetricField>
			</MetricGrid>
			<SecurityPoolButton model={parameters.actions} action='openSecurityPoolAuction' label={copy.open} pendingLabel={copy.opening} reason={deadlineReason ?? model.openReason} onClick={model.open} />
			{auction !== undefined && auction.shortfallAttoEth > 0n && auction.lotAttoEth > 0n && <AuctionLots auction={auction} lots={model.lots} collateral={collateral} />}
			{auction?.finalized === true && (
				<MetricGrid>
					<MetricField label={copy.clearingRep} loading={loadingDetails}>
						<CurrencyValue value={auction.clearing?.attoRepPerLot} suffix={common.rep} />
					</MetricField>
				</MetricGrid>
			)}
			{noSale && <UserMessage tone='warning' detail={copy.closedWithShortfall} />}
			{!closed && auction?.finalized !== true && (
				<>
					<MetricGrid>
						<SecurityPoolInput label={copy.lotCount} hint={copy.lotHint} value={model.lotsInput} onChange={model.setLots} disabled={disabled} />
						<SecurityPoolInput label={copy.minimumRep} hint={askHint} value={model.repInput} onChange={model.setRep} disabled={disabled} numeric />
					</MetricGrid>
					{isOpen && <AuctionAskScale floor={auction.minimumCollateralAttoRepPerLot} ask={model.ask} highest={highest} />}
					<MetricGrid>
						<MetricField label={copy.collateralLocked}>{collateralAmount(model.quote?.bidAttoEth)}</MetricField>
						<MetricField label={copy.repIfFilled}>
							<CurrencyValue value={model.quote?.minimumPrincipalAttoRep} suffix={common.rep} />
						</MetricField>
					</MetricGrid>
					<UserMessage tone='warning' detail={copy.ownership} />
					<UserMessage detail={copy.fairness} />
					<TokenApprovalControl
						actionLabel={copy.bid}
						compact
						customAmountDisclosureLabel={copy.approveCollateral}
						allowanceError={model.error}
						allowanceLoading={model.loading}
						approvedAmount={snapshot?.collateralAllowance}
						disabled={disabled}
						guardMessage={deadlineReason ?? model.fundingReason}
						onApprove={amount => {
							if (amount !== undefined) void model.approve(amount)
						}}
						pending={parameters.actions.busy === 'approveAuctionCollateral'}
						pendingLabel={common.formatApprovingToken(snapshot?.collateral.symbol ?? collateralCopy.fallback)}
						requiredAmount={model.quote?.bidAttoEth}
						resetKey={`${snapshot?.auction?.address}:${parameters.bidder}:${model.quote?.bidAttoEth}`}
						tokenSymbol={snapshot?.collateral.symbol ?? collateralCopy.fallback}
						tokenUnits={snapshot?.collateral.decimals ?? 18}
					/>
					<SecurityPoolButton model={parameters.actions} action='bidSecurityPoolAuction' label={copy.bid} pendingLabel={copy.bidding} reason={deadlineReason ?? model.bidReason} onClick={model.bid} />
				</>
			)}
			<h4>{copy.yourBids}</h4>
			{auction?.bids.length === 0 && !model.loading ? <EmptyState title={copy.noBids} /> : undefined}
			{snapshot !== undefined && auction !== undefined && auction.bids.length > 0 && (
				<table className='statoblast-auction-bid-table' role='table'>
					<thead>
						<tr>
							<th scope='col'>{copy.ask}</th>
							<th scope='col'>{copy.lotsWonAndBid}</th>
							<th scope='col'>{copy.collateralUsed(collateral.symbol)}</th>
							<th scope='col'>{copy.collateralRefundable(collateral.symbol)}</th>
							<th scope='col'>{copy.status}</th>
						</tr>
					</thead>
					{auction.bids.map(bid => (
						<AuctionBid key={bid.id.toString()} auction={auction} bid={bid} model={model} parameters={parameters} collateral={collateral} isOpen={isOpen} />
					))}
				</table>
			)}
			<PaginationControls
				hasPreviousPage={(auction?.bidStart ?? 0n) > 0n}
				hasNextPage={auction !== undefined && auction.bidStart + BigInt(auction.bids.length) < auction.totalBidCount}
				loading={model.loading}
				onPreviousPage={model.previousPage}
				onNextPage={model.nextPage}
				summary={auction === undefined ? undefined : copy.pages(auction.bidStart, auction.bids.length, auction.totalBidCount)}
			/>
			{auction === undefined || auction.totalBidCount === 0n ? undefined : (
				<>
					<MetricGrid>
						<MetricField label={copy.unclaimedBids}>{auction.unclaimedBidCount.toString()}</MetricField>
					</MetricGrid>
					<div className='actions'>
						<SecurityPoolButton model={parameters.actions} action='claimSecurityPoolAuctionBids' label={copy.claimAllBids} pendingLabel={copy.claimingAllBids} reason={model.claimAllReason} hint={auction.unclaimedBidCount === 0n ? undefined : copy.claimHint} onClick={model.claimAllBids} />
					</div>
				</>
			)}
			<div className='actions'>
				<ActionLauncherButton tone='secondary' idleLabel={copy.refresh} pendingLabel={copy.refreshing} availability={{ disabled: refreshReason !== undefined, reason: refreshReason }} onClick={model.refresh} />
			</div>
		</WorkflowSubsection>
	)
}

function AuctionLots({ auction, lots, collateral }: { auction: Auction; lots: bigint | undefined; collateral: Collateral }) {
	const target = (auction.shortfallAttoEth + auction.lotAttoEth - 1n) / auction.lotAttoEth
	const label = copy.lotsForShortfall(target, formatCurrencyBalanceWithUnit(auction.lotAttoEth, collateral.symbol, collateral.decimals))
	const selected = lots === undefined ? undefined : copy.bidLots(lots)
	const covered = lots === undefined || lots <= target ? (lots ?? 0n) : target
	const segments = Number(target > 18n ? 18n : target)
	return (
		<div className='statoblast-auction-lots' role='img' aria-label={copy.lotsAriaLabel(label, selected)}>
			<div className='statoblast-auction-lots-bar' style={{ gridTemplateColumns: `repeat(${segments}, minmax(0, 1fr))` }} aria-hidden='true'>
				{Array.from({ length: segments }, (_, index) => {
					const from = BigInt(index) * target
					const fraction = covered * BigInt(segments) - from
					const quantity = fraction > target ? target : fraction
					const filled = quantity <= 0n ? 0 : Number((quantity * 100n) / target)
					return <span key={index} style={{ '--auction-lot-fill': `${filled}%` }} />
				})}
			</div>
			<span>{label}</span>
			{selected !== undefined && <strong>{selected}</strong>}
		</div>
	)
}

function AuctionAskScale({ floor, ask, highest }: { floor: bigint; ask: bigint | undefined; highest: bigint | undefined }) {
	const marks = [
		{ label: copy.baseAsk, value: floor, color: 'base' },
		{ label: copy.yourAsk, value: ask, color: 'draft' },
		{ label: copy.highestAsk, value: highest, color: 'max' },
	].flatMap(mark => (mark.value === undefined ? [] : [{ ...mark, value: mark.value }]))
	const min = marks.reduce((minimum, mark) => (mark.value < minimum ? mark.value : minimum), floor)
	const max = marks.reduce((maximum, mark) => (mark.value > maximum ? mark.value : maximum), floor)
	const position = (value: bigint) => (min === max ? 50 : 4 + Number(((value - min) * 9_200n) / (max - min)) / 100)
	const range = highest !== undefined && highest >= floor ? { left: position(floor), width: position(highest) - position(floor) } : undefined
	return (
		<div className='statoblast-auction-ask-scale'>
			<strong>{copy.askScale}</strong>
			<div className='statoblast-auction-ask-track' aria-hidden='true'>
				{range !== undefined && <span className='statoblast-auction-ask-range' style={{ insetInlineStart: `${range.left}%`, inlineSize: `${range.width}%` }} />}
				{marks.map(mark => (
					<span key={mark.label} className='statoblast-auction-ask-mark' data-tone={mark.color} style={{ insetInlineStart: `${position(mark.value)}%` }} />
				))}
			</div>
			<dl className='statoblast-auction-ask-legend'>
				{marks.map(mark => (
					<div key={mark.label} data-tone={mark.color}>
						<dt>{mark.label}</dt>
						<dd>
							<CurrencyValue value={mark.value} />
						</dd>
					</div>
				))}
			</dl>
			{highest === undefined && <UserMessage detail={copy.noAdmissibleLimit} />}
		</div>
	)
}

function AuctionBid({ auction, bid, model, parameters, collateral, isOpen }: { auction: Auction; bid: SecurityPoolAuctionBid; model: AuctionModel; parameters: SecurityPoolAuctionParameters; collateral: Collateral; isOpen: boolean }) {
	const excluded = bid.earlyRefundAttoEth > 0n || (!auction.finalized && bid.refundSettled)
	const winning = bid.fill !== undefined && bid.fill.filledLots > 0n
	const loses = excluded || bid.fill?.filledLots === 0n
	let standing = copy.inContention
	if (winning) standing = copy.winning
	else if (loses) standing = copy.outbid
	if (bid.fill?.filledLots === 0n && auction.clearing?.attoRepPerLot === 0n) standing = copy.noFill
	const escrow = bid.lots * auction.lotAttoEth
	const shownLots = bid.fill?.filledLots ?? (excluded ? 0n : undefined)
	let bidStatus: string | undefined = copy.lockedCollateral(formatCurrencyBalanceWithUnit(escrow, collateral.symbol, collateral.decimals))
	if (winning) bidStatus = copy.funded
	else if (bid.fill !== undefined) bidStatus = standing === copy.noFill ? undefined : copy.noFill
	else if (isOpen && excluded && bid.minimumAttoRepPerLot > auction.maximumAdmissibleBidAttoRepPerLot + auction.repGrid) bidStatus = copy.lowerAsksFill
	else if (excluded) bidStatus = copy.earlierBidsFill
	const refundStatus = bid.refundSettled ? copy.refunded : undefined
	let refund: bigint | undefined
	if (excluded) refund = escrow
	if (bid.fill !== undefined) refund = bid.fill.refundAttoEth
	const money = (value: bigint | undefined) => <CurrencyValue value={value} suffix={collateral.symbol} units={collateral.decimals} />
	return (
		<tbody>
			<tr>
				<td data-label={copy.ask}>
					<strong>{copy.askAmount(formatCurrencyBalance(bid.minimumAttoRepPerLot))}</strong>
					<small>{copy.bidLabel(bid.id)}</small>
				</td>
				<td data-label={copy.lotsWonAndBid}>
					{shownLots?.toString() ?? '—'} / {bid.lots.toString()}
				</td>
				<td data-label={copy.collateralUsed(collateral.symbol)}>{money(bid.fill?.usedAttoEth ?? (excluded ? 0n : undefined))}</td>
				<td data-label={copy.collateralRefundable(collateral.symbol)}>{money(refund)}</td>
				<td data-label={copy.status}>
					<Badge tone={winning ? 'ok' : 'muted'}>{standing}</Badge>
					{bidStatus !== undefined && <small>{bidStatus}</small>}
					{refundStatus !== undefined && <small>{refundStatus}</small>}
					{bid.claimed && <small>{copy.claimedStatus}</small>}
				</td>
			</tr>
			<tr>
				<td className='statoblast-auction-bid-actions' colSpan={5}>
					<div className='actions'>
						<SecurityPoolButton model={parameters.actions} action={`refundSecurityPoolAuction${bid.id}`} label={copy.refund} pendingLabel={copy.refunding} reason={model.refundReason(bid)} onClick={() => model.refund(bid)} />
					</div>
					{bid.claimable && (
						<div className='actions'>
							<SecurityPoolButton model={parameters.actions} action={`claimSecurityPoolAuctionBid${bid.id}`} label={copy.claimBid} pendingLabel={copy.claimingBid} reason={model.bidClaimReason(bid)} onClick={() => model.claimBid(bid)} />
						</div>
					)}
					<details open={winning || undefined}>
						<summary>{copy.details}</summary>
						<MetricGrid>
							<MetricField label={copy.principal}>
								<CurrencyValue value={bid.position?.principalAttoRep} suffix={common.rep} />
							</MetricField>
							<MetricField label={copy.commitment}>{money(bid.position?.commitmentAttoEth)}</MetricField>
							<MetricField label={copy.earnedEth}>{money(bid.position?.earnedAttoEth)}</MetricField>
							<MetricField label={copy.earnedRep}>
								<CurrencyValue value={bid.position?.earnedAttoRep} suffix={common.rep} />
							</MetricField>
							<MetricField label={copy.purchasedPrincipal}>
								<CurrencyValue value={bid.fill?.principalAttoRep} suffix={common.rep} />
							</MetricField>
						</MetricGrid>
					</details>
				</td>
			</tr>
		</tbody>
	)
}
