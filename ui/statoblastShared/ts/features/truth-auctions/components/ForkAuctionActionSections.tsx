import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import type { ComponentChildren } from 'preact'
import { AmountField } from '@zoltar/ui-core-shared/components/AmountField.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import { renderTruthAuctionPriceValue } from './ForkAuctionPresentation.js'
import type { ForkAuctionSectionProps } from '../../types.js'
import type { SecurityPoolStateModel } from '../../security-pools/lib/securityPoolState.js'
import { withWalletGuardFirst, type WalletGuard } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { formatRoundedCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getTruthAuctionBidPreview, getRepPerEthPrice, type TruthAuctionBidPricePosition } from '../lib/truthAuctionBook.js'

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

/** Renders fork and truth auction actions. The wallet prerequisite comes before every other blocker, so a disconnected wallet or wrong network offers its connect or switch fix. */
export function createForkAuctionActionRenderer({ activeAction, forkPoolState, walletGuard }: { activeAction: ForkAuctionSectionProps['forkAuctionActiveAction']; forkPoolState: SecurityPoolStateModel; walletGuard: WalletGuard }) {
	return ({ action, availability = { disabled: false, reason: undefined }, forceEnabled, idleLabel, onClick, pendingLabel, pending, tone = 'secondary' }: ForkAuctionActionOptions) => {
		const actionEnabled = forceEnabled ?? forkPoolState.actions[action].enabled
		return <TransactionActionButton idleLabel={idleLabel} pendingLabel={pendingLabel} onClick={onClick} pending={pending ?? activeAction === action} tone={tone} availability={withWalletGuardFirst({ disabled: !actionEnabled || availability.disabled, reason: availability.reason }, walletGuard)} />
	}
}

export function ForkAuctionOutcomePoolNotice({ error, loading, onRetry, outcomeLabel, poolAvailable }: { error: string | undefined; loading: boolean; onRetry: () => void; outcomeLabel: string; poolAvailable: boolean }) {
	if (poolAvailable) return undefined
	let status: ComponentChildren = <ErrorNotice message={error} />
	if (loading) status = <UserMessage className='detail' loading detail={forkAuctionCopy.formatLoadingOutcomePoolDetail(outcomeLabel)} />
	else if (error === undefined) status = <UserMessage className='detail' detail={forkAuctionCopy.formatMissingOutcomePoolDetail(outcomeLabel)} />
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

export function ForkAuctionEndedNotice({ actionButton, currentTimestamp, finalized, onOpenSettlement, truthAuctionEndsAt }: { actionButton: ComponentChildren; currentTimestamp: bigint | undefined; finalized: boolean; onOpenSettlement: (() => void) | undefined; truthAuctionEndsAt: bigint | undefined }) {
	const hasEndedByTime = truthAuctionEndsAt !== undefined && currentTimestamp !== undefined && currentTimestamp >= truthAuctionEndsAt
	if (!finalized && !hasEndedByTime) return undefined
	let actions = finalized ? undefined : actionButton
	if (finalized && onOpenSettlement !== undefined)
		actions = (
			<button className='primary' onClick={onOpenSettlement} type='button'>
				{forkAuctionCopy.openSettlement}
			</button>
		)
	return <UserMessage placement='page' tone='success' title={forkAuctionCopy.auctionEndedStatus} detail={finalized ? forkAuctionCopy.finalizedSettlementDetail : forkAuctionCopy.truthAuctionFinalizationRequiredDetail} actions={actions} />
}

export function ForkAuctionStartSection({ actionButton, bypassReason, readyInText }: { actionButton: ComponentChildren; bypassReason: string | undefined; readyInText: string | undefined }) {
	return (
		<SectionBlock title={forkAuctionCopy.startTruthAuctionTitle} variant='embedded'>
			<UserMessage className='detail' detail={forkAuctionCopy.startTruthAuctionDetail} />
			{readyInText === undefined ? undefined : <UserMessage className='detail' detail={readyInText} />}
			{bypassReason === undefined ? undefined : <UserMessage className='detail' detail={bypassReason} />}
			<div className='actions'>{actionButton}</div>
		</SectionBlock>
	)
}

export function ForkAuctionBidsStatusSection({ error, loading, onRetry, retrying }: { error: string | undefined; loading: boolean; onRetry: () => void; retrying: boolean }) {
	if (!loading && error === undefined && !retrying) return undefined
	return (
		<SectionBlock title={forkAuctionCopy.currentBids} variant='embedded'>
			{loading && !retrying ? <UserMessage className='detail' loading detail={forkAuctionCopy.loadingAuctionBids} /> : undefined}
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

function formatRepPerEthDetail(repPrice: bigint) {
	const repPerEthPrice = getRepPerEthPrice(repPrice)
	return repPerEthPrice === undefined ? undefined : forkAuctionCopy.formatRepPerEthValue(formatRoundedCurrencyBalance(repPerEthPrice, 18, 4))
}

/** Shows the live clearing price and a one-click fill for the lowest price that wins in full. */
function BidPriceGuidance({ clearingPrice, minimumWinningPriceInput, onBidPriceChange }: { clearingPrice: bigint | undefined; minimumWinningPriceInput: string | undefined; onBidPriceChange: (value: string) => void }) {
	if (clearingPrice === undefined) return undefined
	const repPerEthDetail = formatRepPerEthDetail(clearingPrice)
	return (
		<div className='truth-auction-bid-guidance'>
			<UserMessage
				className='detail'
				detail={
					<>
						{forkAuctionCopy.currentClearingPriceLead}
						<strong>{renderTruthAuctionPriceValue(clearingPrice)}</strong>
						{repPerEthDetail === undefined ? undefined : <> {repPerEthDetail}</>}
					</>
				}
			/>
			{minimumWinningPriceInput === undefined ? undefined : (
				<button className='secondary' onClick={() => onBidPriceChange(minimumWinningPriceInput)} type='button'>
					{forkAuctionCopy.formatUseMinimumWinningPrice(minimumWinningPriceInput)}
				</button>
			)}
		</div>
	)
}

function getBidPriceWarning(bidPricePosition: TruthAuctionBidPricePosition | undefined, clearingPrice: bigint | undefined) {
	if (clearingPrice === undefined) return undefined
	if (bidPricePosition === 'below') return forkAuctionCopy.formatBidBelowClearingWarning(formatRoundedCurrencyBalance(clearingPrice, 18, 4))
	if (bidPricePosition === 'at') return forkAuctionCopy.bidAtClearingWarning
	return undefined
}

export function ForkAuctionSubmitBidSection({
	bidPricePosition,
	clearingPrice,
	minimumWinningPriceInput,
	onBidAmountChange,
	onBidPriceChange,
	submitBidAction,
	submitBidAmount,
	submitBidPrice,
}: {
	bidPricePosition: TruthAuctionBidPricePosition | undefined
	clearingPrice: bigint | undefined
	minimumWinningPriceInput: string | undefined
	onBidAmountChange: (value: string) => void
	onBidPriceChange: (value: string) => void
	submitBidAction: ComponentChildren
	submitBidAmount: string
	submitBidPrice: string
}) {
	const bidPriceWarning = getBidPriceWarning(bidPricePosition, clearingPrice)
	const submittedBidPrice = getTruthAuctionBidPreview(submitBidPrice)?.submittedPrice
	const repPerEthDetail = submittedBidPrice === undefined ? undefined : formatRepPerEthDetail(submittedBidPrice)
	return (
		<SectionBlock title={forkAuctionCopy.submitBidTitle} variant='embedded'>
			<div className='form-grid'>
				<BidPriceGuidance clearingPrice={clearingPrice} minimumWinningPriceInput={minimumWinningPriceInput} onBidPriceChange={onBidPriceChange} />
				<div className='field-row truth-auction-bid-fields'>
					<AmountField
						hint={
							<>
								{repPerEthDetail}
								{bidPriceWarning === undefined ? undefined : <span className='truth-auction-bid-price-warning'> {bidPriceWarning}</span>}
							</>
						}
						label={forkAuctionCopy.bidPrice}
						onChange={onBidPriceChange}
						unit={forkAuctionCopy.bidPriceUnit}
						value={submitBidPrice}
					/>
					<AmountField label={forkAuctionCopy.bidAmount} onChange={onBidAmountChange} unit={commonCopy.eth} value={submitBidAmount} />
				</div>
				<div className='actions'>{submitBidAction}</div>
			</div>
		</SectionBlock>
	)
}

export function ForkAuctionSettlementActionSection({ actionButton, description, selectionSummary, title }: { actionButton: ComponentChildren; description: ComponentChildren; selectionSummary: ComponentChildren; title: ComponentChildren }) {
	return (
		<SectionBlock density='compact' title={title} headingLevel={4} variant='embedded'>
			{description === undefined || selectionSummary !== undefined ? undefined : <UserMessage className='detail' detail={description} />}
			{selectionSummary}
			<div className='actions'>{actionButton}</div>
		</SectionBlock>
	)
}
