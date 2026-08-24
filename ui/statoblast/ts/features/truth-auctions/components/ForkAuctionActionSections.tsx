import type { ComponentChildren } from 'preact'
import type { Address } from '@zoltar/shared/ethereum'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as transactionReviewCopy from '@zoltar/ui-core-shared/copy/transactionReview.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import { renderTruthAuctionCapacityOwnershipNotice, renderTruthAuctionPriceValue } from './ForkAuctionPresentation.js'
import type { ForkAuctionSectionProps } from '../../types.js'
import type { SecurityPoolStateModel } from '../../security-pools/lib/securityPoolState.js'
import { AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL } from '../lib/forkAuction.js'

export type ForkAuctionActionOptions = {
	action: NonNullable<ForkAuctionSectionProps['forkAuctionActiveAction']>
	availability?: { disabled: boolean; reason: string | undefined }
	forceEnabled?: boolean
	idleLabel: string
	onClick: () => void
	pendingLabel: string
	pending?: boolean
	tone?: 'primary' | 'secondary'
}

export function createForkAuctionActionRenderer({
	activeAction,
	forkPoolState,
	interactionDisabledReason,
	isOnActiveAppChain,
	wrongNetworkReason,
}: {
	activeAction: ForkAuctionSectionProps['forkAuctionActiveAction']
	forkPoolState: SecurityPoolStateModel
	interactionDisabledReason: string | undefined
	isOnActiveAppChain: boolean
	wrongNetworkReason: string
}) {
	return ({ action, availability = { disabled: false, reason: undefined }, forceEnabled, idleLabel, onClick, pendingLabel, pending, tone = 'secondary' }: ForkAuctionActionOptions) => {
		const actionEnabled = forceEnabled ?? forkPoolState.actions[action].enabled
		return (
			<TransactionActionButton
				idleLabel={idleLabel}
				pendingLabel={pendingLabel}
				onClick={onClick}
				pending={pending ?? activeAction === action}
				tone={tone}
				availability={{
					disabled: !isOnActiveAppChain || !actionEnabled || interactionDisabledReason !== undefined || availability.disabled,
					reason: !isOnActiveAppChain ? wrongNetworkReason : (interactionDisabledReason ?? availability.reason),
				}}
			/>
		)
	}
}

export function ForkAuctionOutcomePoolNotice({ error, loading, onRetry, outcomeLabel, poolAvailable }: { error: string | undefined; loading: boolean; onRetry: () => void; outcomeLabel: string; poolAvailable: boolean }) {
	if (poolAvailable) return undefined
	let status: ComponentChildren = <ErrorNotice message={error} />
	if (loading)
		status = (
			<p className='detail'>
				<LoadingText>{forkAuctionCopy.formatLoadingOutcomePoolDetail(outcomeLabel)}</LoadingText>
			</p>
		)
	else if (error === undefined) status = <p className='detail'>{forkAuctionCopy.formatMissingOutcomePoolDetail(outcomeLabel)}</p>
	return (
		<div className='fork-workflow-outcome-notice'>
			{status}
			{error === undefined ? undefined : (
				<div className='actions'>
					<button className='secondary' onClick={onRetry} type='button'>
						{forkAuctionCopy.retryChildUniverse}
					</button>
				</div>
			)}
		</div>
	)
}

export function ForkAuctionEndedNotice({ actionButton, currentTimestamp, finalized, truthAuctionEndsAt }: { actionButton: ComponentChildren; currentTimestamp: bigint | undefined; finalized: boolean; truthAuctionEndsAt: bigint | undefined }) {
	const hasEndedByTime = truthAuctionEndsAt !== undefined && currentTimestamp !== undefined && currentTimestamp >= truthAuctionEndsAt
	if (!finalized && !hasEndedByTime) return undefined
	return (
		<div className='notice success'>
			<p>
				<strong>{forkAuctionCopy.auctionEndedStatus}</strong> {finalized ? forkAuctionCopy.formatFinalizedSettlementDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL) : forkAuctionCopy.truthAuctionFinalizationRequiredDetail}{' '}
				{truthAuctionEndsAt === undefined ? undefined : (
					<>
						{forkAuctionCopy.endedAtLead}
						<TimestampValue {...(currentTimestamp === undefined ? {} : { currentTimestamp })} timestamp={truthAuctionEndsAt} />
					</>
				)}
			</p>
			{finalized ? undefined : <div className='actions'>{actionButton}</div>}
		</div>
	)
}

export function ForkAuctionStartSection({ actionButton, bypassReason, readyInText }: { actionButton: ComponentChildren; bypassReason: string | undefined; readyInText: string | undefined }) {
	return (
		<SectionBlock title={forkAuctionCopy.startTruthAuctionTitle} variant='embedded'>
			<p className='detail'>{forkAuctionCopy.formatStartTruthAuctionDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)}</p>
			{readyInText === undefined ? undefined : <p className='detail'>{readyInText}</p>}
			{bypassReason === undefined ? undefined : <p className='detail'>{bypassReason}</p>}
			<div className='actions'>{actionButton}</div>
		</SectionBlock>
	)
}

export function ForkAuctionBidsStatusSection({ error, loading, onRetry, retrying }: { error: string | undefined; loading: boolean; onRetry: () => void; retrying: boolean }) {
	if (!loading && error === undefined && !retrying) return undefined
	return (
		<SectionBlock title={forkAuctionCopy.currentBids} variant='embedded'>
			{loading && !retrying ? (
				<p className='detail'>
					<LoadingText>{forkAuctionCopy.loadingAuctionBids}</LoadingText>
				</p>
			) : undefined}
			<ErrorNotice message={error} />
			{error === undefined && !retrying ? undefined : (
				<div className='actions'>
					<button className='secondary' disabled={retrying} onClick={onRetry} type='button'>
						{retrying ? <LoadingText>{forkAuctionCopy.retryingAuctionDetails}</LoadingText> : forkAuctionCopy.retryAuctionDetails}
					</button>
				</div>
			)}
		</SectionBlock>
	)
}

export function ForkAuctionSubmitBidSection({
	auctionSecurityPoolAddress,
	enteredBidAmount,
	enteredBidPrice,
	estimatedAttoRep,
	onBidAmountChange,
	onBidPriceChange,
	questionTitle,
	resultingBidBalanceAttoEth,
	selectedAuctionLabel,
	submitBidAction,
	submitBidAmount,
	submitBidPreviewPrice,
	submitBidPrice,
	submittedBidPrice,
}: {
	auctionSecurityPoolAddress: Address | undefined
	enteredBidAmount: bigint | undefined
	enteredBidPrice: bigint | undefined
	estimatedAttoRep: bigint | undefined
	onBidAmountChange: (value: string) => void
	onBidPriceChange: (value: string) => void
	questionTitle: string | undefined
	resultingBidBalanceAttoEth: bigint | undefined
	selectedAuctionLabel: string
	submitBidAction: ComponentChildren
	submitBidAmount: string
	submitBidPreviewPrice: bigint | undefined
	submitBidPrice: string
	submittedBidPrice: bigint | undefined
}) {
	return (
		<SectionBlock title={forkAuctionCopy.submitBidTitle} variant='embedded'>
			<div className='form-grid'>
				{submitBidPreviewPrice === undefined ? undefined : (
					<p className='detail'>
						{forkAuctionCopy.selectedLadderPriceLead}
						{renderTruthAuctionPriceValue(submitBidPreviewPrice)}
					</p>
				)}
				<div className='field-row'>
					<label className='field'>
						<span>{forkAuctionCopy.bidPriceEthRep}</span>
						<FormInput value={submitBidPrice} onInput={event => onBidPriceChange(event.currentTarget.value)} />
					</label>
					<label className='field'>
						<span>{forkAuctionCopy.bidAmountEth}</span>
						<FormInput value={submitBidAmount} onInput={event => onBidAmountChange(event.currentTarget.value)} />
					</label>
				</div>
				<TransactionReview
					context={[
						{ label: commonCopy.question, value: questionTitle ?? commonCopy.unavailable },
						{ label: commonCopy.securityPoolAddress, value: auctionSecurityPoolAddress === undefined ? commonCopy.unavailable : <AddressValue address={auctionSecurityPoolAddress} /> },
						{ label: commonCopy.outcome, value: selectedAuctionLabel },
					]}
					primary={[
						{ label: transactionReviewCopy.youPay, value: <CurrencyValue value={enteredBidAmount} suffix={commonCopy.eth} /> },
						{ label: forkAuctionCopy.potentialRepIfFilled, value: <CurrencyValue value={estimatedAttoRep} suffix={commonCopy.rep} /> },
					]}
					details={[
						{ label: forkAuctionCopy.enteredBidPrice, value: enteredBidPrice === undefined ? commonCopy.metricUnavailablePlaceholder : renderTruthAuctionPriceValue(enteredBidPrice) },
						{ label: forkAuctionCopy.submittedTickPrice, value: submittedBidPrice === undefined ? commonCopy.metricUnavailablePlaceholder : renderTruthAuctionPriceValue(submittedBidPrice) },
						{ label: transactionReviewCopy.resultingEthBalance, value: <CurrencyValue value={resultingBidBalanceAttoEth} suffix={commonCopy.eth} /> },
					]}
					risks={[forkAuctionCopy.bidEscrowRisk, forkAuctionCopy.bidFillRisk, forkAuctionCopy.winningBidCapacityOwnershipRisk]}
				/>
				<div className='actions'>{submitBidAction}</div>
			</div>
		</SectionBlock>
	)
}

export function ForkAuctionSettlementActionSection({ actionButton, description, selectionSummary, showRefundOnlyNotice, title }: { actionButton: ComponentChildren; description: ComponentChildren; selectionSummary: ComponentChildren; showRefundOnlyNotice: boolean; title: ComponentChildren }) {
	return (
		<SectionBlock density='compact' title={title} headingLevel={4} variant='embedded'>
			{description === undefined || selectionSummary !== undefined ? undefined : <p className='detail'>{description}</p>}
			{selectionSummary}
			{selectionSummary === undefined ? renderTruthAuctionCapacityOwnershipNotice(showRefundOnlyNotice) : undefined}
			<div className='actions'>{actionButton}</div>
		</SectionBlock>
	)
}
