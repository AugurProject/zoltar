import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { toHex } from '@zoltar/core-shared/evm/ethereum'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { PortfolioButton, PortfolioInput, type PortfolioActions } from './PortfolioControls.js'
import type { usePortfolioAggregate } from '../hooks/usePortfolioAggregate.js'
import { buildPoolsRouteHash } from '../../../lib/statoblastLocation.js'
import * as copy from '../../../copy/portfolio.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

type Model = ReturnType<typeof usePortfolioAggregate>

export function PortfolioAggregatePanel({ model, actions }: { model: Model; actions: Pick<PortfolioActions, 'scope' | 'busy'> }) {
	const snapshot = model.snapshot
	return (
		<>
			<SectionBlock title={copy.sharedFund} description={copy.sharedFundHint}>
				{model.readError === undefined ? undefined : <UserMessage tone='error' detail={model.readError} />}
				<MetricGrid>
					<MetricField label={copy.poolAssets} loading={model.loading}>
						<CurrencyValue value={snapshot?.assetsAttoRep} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={copy.availableBacking} loading={model.loading}>
						<CurrencyValue value={snapshot?.availableAttoRep} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={copy.backedCapacity} loading={model.loading}>
						<CurrencyValue value={snapshot?.backedCapacityAttoEth} suffix={commonCopy.eth} />
					</MetricField>
					<MetricField label={copy.yourFundShares} loading={model.loading}>
						<CurrencyValue value={snapshot?.shares} />
					</MetricField>
					<MetricField label={copy.yourCurrentRep} loading={model.loading}>
						<CurrencyValue value={snapshot?.ownerAssetsAttoRep} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={copy.fees} loading={model.loading}>
						<CurrencyValue value={snapshot?.claimableFeesAttoEth} suffix={commonCopy.eth} />
					</MetricField>
				</MetricGrid>
				<PortfolioButton model={actions} action='claimPortfolioFundFees' label={copy.claimFundFees} pendingLabel={copy.claimingFundFees} reason={model.claimFeesReason} onClick={model.claimFees} />
			</SectionBlock>
			<SectionBlock title={copy.depositPoolRep} description={copy.depositPoolHint}>
				<MetricGrid>
					<PortfolioInput label={copy.amount} value={model.depositAmount} onChange={model.setDepositAmount} disabled={actions.busy !== undefined} numeric />
					<PortfolioInput label={copy.minimumFundShares} value={model.depositMinimum} onChange={model.setDepositMinimum} disabled={actions.busy !== undefined} numeric />
				</MetricGrid>
				<UserMessage tone='warning' detail={copy.fundRisk} />
				<TokenApprovalControl
					actionLabel={copy.depositPoolRep}
					allowanceError={model.readError}
					allowanceLoading={model.loading}
					approvedAmount={snapshot?.allowanceAttoRep}
					disabled={actions.busy !== undefined}
					guardMessage={model.fundingReason}
					onApprove={value => void model.approve(value)}
					pending={actions.busy === 'approvePortfolioRep'}
					pendingLabel={copy.approvingPoolRep}
					requiredAmount={model.depositAttoRep}
					resetKey={`${snapshot?.portfolio}:${snapshot?.owner}:${model.depositAmount}`}
					tokenSymbol={commonCopy.rep}
					tokenUnits={18}
				/>
				<PortfolioButton model={actions} action='depositPortfolioRep' label={copy.depositPoolRep} pendingLabel={copy.depositingPoolRep} reason={model.depositReason} onClick={model.deposit} />
			</SectionBlock>
			<SectionBlock title={copy.mint} description={copy.mintHint}>
				<PortfolioInput label={copy.questionId} value={model.questionInput} onChange={model.setQuestionInput} disabled={actions.busy !== undefined} />
				{model.position === undefined ? undefined : <a href={buildPoolsRouteHash({ view: 'operate', securityPoolAddress: model.position.pool, tab: 'vaults' })}>{copy.openPrice}</a>}
				<MetricGrid>
					<PortfolioInput label={copy.mintAmount} value={model.mintAmount} onChange={model.setMintAmount} disabled={actions.busy !== undefined} numeric />
					<PortfolioInput label={copy.maximumReservationFee} hint={copy.maximumReservationFeeHint} value={model.maximumFee} onChange={model.setMaximumFee} disabled={actions.busy !== undefined} numeric />
					<PortfolioInput label={copy.minimumShares} value={model.minimumShares} onChange={model.setMinimumShares} disabled={actions.busy !== undefined} numeric />
				</MetricGrid>
				<MetricGrid>
					<MetricField label={copy.estimatedReservationFee} loading={model.quoteLoading}>
						<CurrencyValue value={model.quote?.reservationFeeAttoEth} suffix={commonCopy.eth} />
					</MetricField>
				</MetricGrid>
				{model.quoteError === undefined ? undefined : <UserMessage tone='error' detail={model.quoteError} />}
				<div className='actions'>
					<ActionLauncherButton tone='secondary' idleLabel={copy.retryReservationFee} pendingLabel={copy.reservationFeeLoading} availability={{ disabled: actions.busy !== undefined || model.quoteLoading, reason: actions.busy !== undefined ? copy.busy : copy.reservationFeeLoading }} onClick={model.retryQuote} />
					<PortfolioButton model={actions} action='mintPortfolioCompleteSet' label={copy.mint} pendingLabel={copy.minting} reason={model.mintReason} onClick={model.mint} />
				</div>
			</SectionBlock>
			<SectionBlock title={copy.withdrawFund} description={copy.withdrawFundHint}>
				<MetricGrid>
					<PortfolioInput label={copy.fundSharesToWithdraw} value={model.withdrawalShares} onChange={model.setWithdrawalShares} disabled={actions.busy !== undefined} numeric />
					<PortfolioInput label={copy.minimumIdleRep} value={model.withdrawalMinimum} onChange={model.setWithdrawalMinimum} disabled={actions.busy !== undefined} numeric />
				</MetricGrid>
				<PortfolioButton model={actions} action='withdrawPortfolioFund' label={copy.withdrawFund} pendingLabel={copy.withdrawingFund} reason={model.withdrawalReason} onClick={model.withdraw} />
			</SectionBlock>
			<SectionBlock title={copy.maturedClaims} description={copy.maturedClaimsHint}>
				<PortfolioButton model={actions} action='syncPortfolioFund' label={copy.syncFund} pendingLabel={copy.syncingFund} reason={model.claimReason} onClick={model.sync} />
				<UserMessage detail={copy.syncFundHint} />
				{model.claims.length === 0 ? (
					<EmptyState title={copy.noMaturedClaims} />
				) : (
					model.claims.map(claim => (
						<div className='workflow-subsection' key={String(claim.positionId)}>
							<MetricGrid>
								<MetricField label={copy.archivePosition}>{String(claim.positionId)}</MetricField>
								<MetricField label={copy.questionId}>
									<code>{toHex(claim.questionId)}</code>
								</MetricField>
							</MetricGrid>
							<PortfolioButton model={actions} action={`claimPortfolioPosition:${claim.positionId}`} label={copy.claimQuestion} pendingLabel={copy.claimingQuestion} reason={model.claimReason} onClick={() => model.claimPosition(claim.positionId)} />
						</div>
					))
				)}
				<PaginationControls hasPreviousPage={(snapshot?.positionStart ?? 0n) > 0n} hasNextPage={snapshot !== undefined && snapshot.positionStart + 64n < snapshot.positionCount} loading={model.loading} onPreviousPage={model.previousPage} onNextPage={model.nextPage} />
			</SectionBlock>
		</>
	)
}
