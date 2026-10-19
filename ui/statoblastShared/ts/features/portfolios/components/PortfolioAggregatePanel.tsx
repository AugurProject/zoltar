import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { useId } from 'preact/hooks'
import { toHex, formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { PortfolioButton, PortfolioInput, type PortfolioActions } from './PortfolioControls.js'
import { PortfolioForkClaim } from './PortfolioForkClaim.js'
import { PortfolioSharedFork } from './PortfolioSharedFork.js'
import type { usePortfolioAggregate } from '../hooks/usePortfolioAggregate.js'
import { buildPoolsRouteHash } from '../../../lib/statoblastLocation.js'
import * as copy from '../../../copy/portfolio.js'
import * as sharedForkCopy from '../../../copy/portfolioSharedFork.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

type Model = ReturnType<typeof usePortfolioAggregate>
const admissionLabels = { open: copy.admissionOpen, fixed: copy.admissionFixed, custom: copy.admissionCustom }

function allocationStatus(allocation: Model['allocations'][number], forked: boolean) {
	if (allocation.recoveryComplete) return forked ? sharedForkCopy.sourceRecovered : copy.recoveryComplete
	if (allocation.remainingShares === 0n) return copy.positionClaimed
	return allocation.reusable ? copy.reusablePosition : copy.historicalPosition
}

export function PortfolioAggregatePanel({ model, actions }: { model: Model; actions: Pick<PortfolioActions, 'scope' | 'busy' | 'ownerReason' | 'runPortfolioAction'> }) {
	const snapshot = model.snapshot
	const pagedRecovery = snapshot !== undefined && snapshot.intervalCount > 64n
	const questionSelectId = useId()
	const selectedQuestion = snapshot?.questions.find(questionId => String(questionId) === model.questionInput || toHex(questionId) === model.questionInput)
	return (
		<>
			<SectionBlock title={copy.sharedFund} description={copy.sharedFundHint}>
				{model.admission?.mode === 'custom' ? <UserMessage tone='warning' detail={copy.unsupportedAdmission} /> : undefined}
				{model.readError === undefined ? undefined : <UserMessage tone='error' detail={model.readError} />}
				<MetricGrid>
					<MetricField label={copy.poolAssets} loading={model.loading}>
						<CurrencyValue value={snapshot?.assetsAttoRep} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={copy.backedCapacity} loading={model.loading}>
						<CurrencyValue value={snapshot?.reserveCapacityAttoEth} suffix={commonCopy.eth} />
					</MetricField>
					<MetricField label={copy.yourFundShares} loading={model.loading}>
						<CurrencyValue value={snapshot?.shares} />
					</MetricField>
					<MetricField label={copy.yourCurrentRep} loading={model.loading}>
						<CurrencyValue value={snapshot?.ownerAssetsAttoRep} suffix={commonCopy.rep} />
					</MetricField>
				</MetricGrid>
				<MetricGrid>
					<MetricField label={copy.admissionMode} loading={model.loading}>
						{model.admission === undefined ? undefined : admissionLabels[model.admission.mode]}
					</MetricField>
					<MetricField label={copy.targetHealthPercent} loading={model.loading}>
						{snapshot === undefined ? undefined : formatUnits(snapshot.economics.targetHealthFactorBps, 2)}
					</MetricField>
					<MetricField label={copy.purchaseFeePercent} loading={model.loading}>
						{snapshot === undefined ? undefined : formatUnits(snapshot.economics.purchaseFeeBps, 2)}
					</MetricField>
					<MetricField label={copy.minimumPurchaseFee} loading={model.loading}>
						<CurrencyValue value={snapshot?.economics.minimumPurchaseFeeAttoEth} suffix={commonCopy.eth} />
					</MetricField>
					<MetricField label={copy.completionReward} loading={model.loading}>
						<CurrencyValue value={snapshot?.economics.completionRewardAttoEth} suffix={commonCopy.eth} />
					</MetricField>
					<MetricField label={copy.maintenanceBudget} loading={model.loading}>
						<CurrencyValue value={snapshot?.maintenanceBudgetAttoEth} suffix={commonCopy.eth} />
					</MetricField>
				</MetricGrid>
				{model.admission?.mode === 'fixed' ? (
					<details>
						<summary>{copy.fixedQuestionIds}</summary>
						<UserMessage detail={copy.approvedQuestionCount(model.admission.questionCount)} />
						<UserMessage detail={copy.admissionFixedHint} />
						<ul>
							{model.admission.questions.map(questionId => (
								<li key={String(questionId)}>
									<code>{toHex(questionId)}</code>
								</li>
							))}
						</ul>
						<PaginationControls hasPreviousPage={model.admission.questionStart > 0n} hasNextPage={model.admission.questionStart + 64n < model.admission.questionCount} loading={model.loading} onPreviousPage={model.previousApprovedQuestionPage} onNextPage={model.nextApprovedQuestionPage} />
					</details>
				) : undefined}
			</SectionBlock>
			<SectionBlock title={copy.combinedRecovery} description={copy.combinedRecoveryHint}>
				<MetricGrid>
					<MetricField label={pagedRecovery ? copy.recoveredRepPageSubtotal : copy.recoveredRep} loading={model.loading}>
						<CurrencyValue value={snapshot?.recoverableRepAttoRep} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={pagedRecovery ? copy.recoveredFeesPageSubtotal : copy.recoveredFees} loading={model.loading}>
						<CurrencyValue value={snapshot?.recoverableFeesAttoEth} suffix={commonCopy.eth} />
					</MetricField>
				</MetricGrid>
				{pagedRecovery ? (
					<>
						<UserMessage detail={copy.recoveryPageHint} />
						<UserMessage detail={copy.activeRecoveryPage(snapshot.intervals.length, snapshot.intervalCount)} />
					</>
				) : undefined}
				<PortfolioInput label={copy.recoveryBatchLabel} hint={copy.recoveryBatchHint} value={model.recoveryBatchSize} onChange={model.setRecoveryBatchSize} disabled={actions.busy !== undefined} numeric />
				{model.recoveryPositionCount > 0 ? <UserMessage detail={copy.readyRecoveryPositions(model.recoveryPositionCount)} /> : undefined}
				<PortfolioButton model={actions} action='collectPortfolioRecovery' label={copy.collectRecovered} pendingLabel={copy.collectingRecovered} reason={model.collectReason} onClick={model.collectRecovered} />
				<details>
					<summary>{copy.redepositRecovered}</summary>
					<div className='form-grid'>
						<UserMessage detail={copy.redepositHint} />
						<PortfolioInput label={copy.redepositMinimum} value={model.redepositMinimum} onChange={model.setRedepositMinimum} disabled={actions.busy !== undefined} numeric />
						<MetricGrid>
							<MetricField label={copy.currentOwnershipFee} loading={model.loading}>
								<CurrencyValue value={snapshot?.ownershipChangeFeeAttoEth} suffix={commonCopy.eth} />
							</MetricField>
						</MetricGrid>
						<PortfolioButton model={actions} action='redepositPortfolioRecovery' label={copy.redepositRecovered} pendingLabel={copy.redepositingRecovered} reason={model.redepositReason} onClick={model.redepositRecovered} />
					</div>
				</details>
				<PaginationControls hasPreviousPage={model.hasPreviousIntervalPage} hasNextPage={snapshot !== undefined && snapshot.nextIntervalCursor !== 0n} loading={model.loading} onPreviousPage={model.previousIntervalPage} onNextPage={model.nextIntervalPage} />
			</SectionBlock>
			{snapshot !== undefined && snapshot.forkTime > 0n ? <PortfolioSharedFork snapshot={snapshot} actions={actions} onConfirmed={model.refresh} /> : undefined}
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
				<MetricField label={copy.currentOwnershipFee} loading={model.loading}>
					<CurrencyValue value={snapshot?.ownershipChangeFeeAttoEth} suffix={commonCopy.eth} />
				</MetricField>
				<PortfolioButton model={actions} action='depositPortfolioRep' label={copy.depositPoolRep} pendingLabel={copy.depositingPoolRep} reason={model.depositReason} onClick={model.deposit} />
			</SectionBlock>
			<SectionBlock title={copy.mint} description={copy.mintHint}>
				<div className='field'>
					<label htmlFor={questionSelectId}>{copy.registeredQuestions}</label>
					<select id={questionSelectId} value={selectedQuestion === undefined ? '' : toHex(selectedQuestion)} disabled={actions.busy !== undefined || model.loading} onChange={event => model.setQuestionInput(event.currentTarget.value)}>
						<option value=''>{copy.chooseRegisteredQuestion}</option>
						{snapshot?.questions.map(questionId => (
							<option key={String(questionId)} value={toHex(questionId)}>
								{toHex(questionId)}
							</option>
						))}
					</select>
				</div>
				<PaginationControls hasPreviousPage={(snapshot?.questionStart ?? 0n) > 0n} hasNextPage={snapshot !== undefined && snapshot.questionStart + 64n < snapshot.questionCount} loading={model.loading} onPreviousPage={model.previousQuestionPage} onNextPage={model.nextQuestionPage} />
				<PortfolioInput label={copy.questionId} value={model.questionInput} onChange={model.setQuestionInput} disabled={actions.busy !== undefined} />
				{model.position === undefined ? undefined : <a href={buildPoolsRouteHash({ view: 'operate', securityPoolAddress: model.position.pool, tab: 'vaults' })}>{copy.openPrice}</a>}
				<MetricGrid>
					<PortfolioInput label={copy.mintAmount} value={model.mintAmount} onChange={model.setMintAmount} disabled={actions.busy !== undefined} numeric />
					<PortfolioInput label={copy.maximumPurchaseFee} hint={copy.maximumPurchaseFeeHint} value={model.maximumFee} onChange={model.setMaximumFee} disabled={actions.busy !== undefined} numeric />
					<PortfolioInput label={copy.minimumShares} value={model.minimumShares} onChange={model.setMinimumShares} disabled={actions.busy !== undefined} numeric />
				</MetricGrid>
				<MetricGrid>
					<MetricField label={copy.estimatedPurchaseFee} loading={model.quoteLoading}>
						<CurrencyValue value={model.quote?.purchaseFeeAttoEth} suffix={commonCopy.eth} />
					</MetricField>
				</MetricGrid>
				{model.quoteError === undefined ? undefined : <UserMessage tone='error' detail={model.quoteError} />}
				<div className='actions'>
					<ActionLauncherButton tone='secondary' idleLabel={copy.retryPurchaseFee} pendingLabel={copy.purchaseFeeLoading} availability={{ disabled: actions.busy !== undefined || model.quoteLoading, reason: actions.busy !== undefined ? copy.busy : copy.purchaseFeeLoading }} onClick={model.retryQuote} />
					<PortfolioButton model={actions} action='mintPortfolioCompleteSet' label={copy.mint} pendingLabel={copy.minting} reason={model.mintReason} onClick={model.mint} />
				</div>
			</SectionBlock>
			<SectionBlock title={copy.withdrawFund} description={copy.withdrawFundHint}>
				<MetricGrid>
					<PortfolioInput label={copy.fundSharesToWithdraw} value={model.withdrawalShares} onChange={model.setWithdrawalShares} disabled={actions.busy !== undefined} numeric />
					<PortfolioInput label={copy.minimumIdleRep} value={model.withdrawalMinimum} onChange={model.setWithdrawalMinimum} disabled={actions.busy !== undefined} numeric />
				</MetricGrid>
				<MetricField label={copy.currentOwnershipFee} loading={model.loading}>
					<CurrencyValue value={model.withdrawalFee} suffix={commonCopy.eth} />
				</MetricField>
				<PortfolioButton model={actions} action='withdrawPortfolioFund' label={copy.withdrawFund} pendingLabel={copy.withdrawingFund} reason={model.withdrawalReason} onClick={model.withdraw} />
			</SectionBlock>
			<SectionBlock title={copy.allocationPositions} description={copy.allocationPositionsHint}>
				{model.allocations.length === 0 ? (
					<EmptyState title={copy.noAllocationPositions} />
				) : (
					model.allocations.map(claim => (
						<div className='workflow-subsection' key={String(claim.positionId)}>
							<MetricGrid>
								<MetricField label={copy.allocationPosition}>{String(claim.positionId)}</MetricField>
								<MetricField label={copy.questionId}>
									<code>{toHex(claim.questionId)}</code>
								</MetricField>
								<MetricField label={copy.processingReward}>
									<CurrencyValue value={claim.recoveryBountyAttoEth} suffix={commonCopy.eth} />
								</MetricField>
								<MetricField label={copy.allocationStatus}>
									<Badge tone={claim.reusable ? 'ok' : 'muted'}>{allocationStatus(claim, snapshot !== undefined && snapshot.forkTime > 0n)}</Badge>
								</MetricField>
							</MetricGrid>
							{claim.remainingShares === 0n || claim.recoveryComplete ? undefined : <UserMessage detail={claim.reusable ? copy.reusablePositionHint : copy.historicalPositionHint} />}
							{claim.recoveryComplete && snapshot !== undefined && snapshot.forkTime > 0n ? <UserMessage detail={sharedForkCopy.sourceRecoveredHint} /> : undefined}
							<div className='actions'>
								<PortfolioButton model={actions} action={`recyclePortfolioPosition:${claim.positionId}`} label={copy.recyclePosition} pendingLabel={copy.recyclingPosition} reason={claim.rebalanceReason} onClick={() => model.recyclePosition(claim.positionId)} />
								<PortfolioButton model={actions} action={`rebalancePortfolioPosition:${claim.positionId}`} label={copy.rebalancePosition} pendingLabel={copy.rebalancingPosition} reason={claim.rebalanceReason} onClick={() => model.rebalancePosition(claim.positionId)} />
							</div>
							<details>
								<summary>{copy.individualControl}</summary>
								<UserMessage tone='warning' detail={copy.individualControlHint} />
								<PortfolioButton model={actions} action={`claimPortfolioPosition:${claim.positionId}`} label={copy.claimQuestion} pendingLabel={copy.claimingQuestion} reason={claim.claimReason} onClick={() => model.claimPosition(claim.positionId)} />
								{snapshot !== undefined && snapshot.forkTime > 0n ? <PortfolioForkClaim snapshot={snapshot} allocation={claim} actions={actions} onConfirmed={model.refresh} /> : undefined}
							</details>
						</div>
					))
				)}
				<PaginationControls hasPreviousPage={(snapshot?.positionStart ?? 0n) > 0n} hasNextPage={snapshot !== undefined && snapshot.positionStart + 64n < snapshot.positionCount} loading={model.loading} onPreviousPage={model.previousPage} onNextPage={model.nextPage} />
			</SectionBlock>
		</>
	)
}
