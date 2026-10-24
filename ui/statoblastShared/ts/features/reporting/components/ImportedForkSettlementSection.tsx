import { isFinalClaimCheckpointBatch } from '@zoltar/statoblast-shared/escalationGame/claimCheckpoint'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/reportingEscalation.js'
import type { ComponentChildren } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, resolvePaginationPageIndex } from '@zoltar/ui-core-shared/lib/pagination.js'
import { getImportedEscalationDepositClaimAmount } from '../lib/reportingDomain.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { AuthenticatedForkClaim, ActiveReportingDetails, EscalationSide } from '../../../types/contracts.js'

const IMPORTED_FORK_SETTLEMENT_PAGE_SIZE = 25

type ImportedForkSettlementActionRenderProps = {
	guardMessage: string | undefined
	outcome: ReportingOutcomeKey
	sideLabel: string
}

type PreparationRenderProps = { outcome: ReportingOutcomeKey; parentDepositIndex: bigint; identity: AuthenticatedForkClaim | undefined; settlementGuardMessage: string | undefined; ready: boolean; progress: string | undefined }

type ImportedForkSettlementSectionProps = {
	activeReportingDetails: ActiveReportingDetails | undefined
	disabled: boolean
	onDepositSelectionChange: (outcome: ReportingOutcomeKey, depositIndex: bigint, checked: boolean) => void
	renderPreparationAction?: ((props: PreparationRenderProps) => ComponentChildren) | undefined
	renderSettlementAction: (props: ImportedForkSettlementActionRenderProps) => ComponentChildren
	resolved: boolean
	selectedDepositIndexesByOutcome: Record<ReportingOutcomeKey, bigint[]>
	sides: Pick<EscalationSide, 'importedUserDeposits' | 'key' | 'label'>[]
	winningOutcome: ReportingOutcomeKey | undefined
}

type ImportedForkSettlementSideProps = {
	activeReportingDetails: ActiveReportingDetails | undefined
	disabled: boolean
	onDepositSelectionChange: (outcome: ReportingOutcomeKey, depositIndex: bigint, checked: boolean) => void
	renderPreparationAction?: ((props: PreparationRenderProps) => ComponentChildren) | undefined
	renderSettlementAction: (props: ImportedForkSettlementActionRenderProps) => ComponentChildren
	resolved: boolean
	selectedDepositIndexes: bigint[]
	side: Pick<EscalationSide, 'importedUserDeposits' | 'key' | 'label'>
}

function ImportedForkSettlementSide({ activeReportingDetails, disabled, onDepositSelectionChange, renderPreparationAction, renderSettlementAction, resolved, selectedDepositIndexes, side }: ImportedForkSettlementSideProps) {
	const [pageIndex, setPageIndex] = useState(0)
	const pageCount = getPaginationPageCount(BigInt(side.importedUserDeposits.length), IMPORTED_FORK_SETTLEMENT_PAGE_SIZE)
	const resolvedPageIndex = resolvePaginationPageIndex(pageIndex, pageCount)
	const hasNextPage = getHasNextPaginationPage(resolvedPageIndex, pageCount)
	const hasPreviousPage = resolvedPageIndex > 0
	const pageStartIndex = resolvedPageIndex * IMPORTED_FORK_SETTLEMENT_PAGE_SIZE
	const pageEndIndex = Math.min(side.importedUserDeposits.length, pageStartIndex + IMPORTED_FORK_SETTLEMENT_PAGE_SIZE)
	const visibleDeposits = useMemo(() => side.importedUserDeposits.slice(pageStartIndex, pageEndIndex), [pageEndIndex, pageStartIndex, side.importedUserDeposits])
	const paginationPageSummary = formatPaginationSummary(resolvedPageIndex, pageCount)
	const paginationSummary =
		side.importedUserDeposits.length > IMPORTED_FORK_SETTLEMENT_PAGE_SIZE && paginationPageSummary !== undefined ? forkAuctionCopy.formatImportedForkDepositPageSummary((pageStartIndex + 1).toString(), pageEndIndex.toString(), side.importedUserDeposits.length.toString(), paginationPageSummary) : undefined
	const settlementGuardMessage = (() => {
		if (!resolved) return forkAuctionCopy.forkDepositSettlementAvailabilityDetail
		if (selectedDepositIndexes.length === 0) return forkAuctionCopy.formatDepositSelectionRequired(side.label)
		if (side.importedUserDeposits.some(deposit => selectedDepositIndexes.includes(deposit.parentDepositIndex) && deposit.claimCheckpoint?.ready === false)) return forkAuctionCopy.prepareInheritedClaimFirst
		return undefined
	})()

	useEffect(() => {
		if (resolvedPageIndex !== pageIndex) setPageIndex(resolvedPageIndex)
	}, [pageIndex, resolvedPageIndex])

	return (
		<SectionBlock density='compact' headingLevel={4} key={side.key} title={side.label} variant='embedded'>
			<div className='withdraw-deposit-list'>
				<span className='detail'>{forkAuctionCopy.importedFromParentUniverse}</span>
				<div className='escalation-selection-list'>
					{visibleDeposits.map(deposit => {
						const selected = selectedDepositIndexes.includes(deposit.parentDepositIndex)
						const claimAmount = getImportedEscalationDepositClaimAmount(activeReportingDetails, side.key, deposit)
						return (
							<div className='escalation-selection-item' key={deposit.parentDepositIndex.toString()}>
								<label className='escalation-selection-control'>
									<input checked={selected} disabled={disabled} onChange={event => onDepositSelectionChange(side.key, deposit.parentDepositIndex, event.currentTarget.checked)} type='checkbox' />
									<span className='escalation-selection-item-copy'>
										<strong>
											{forkAuctionCopy.parentDepositNumber}
											{deposit.parentDepositIndex.toString()}
										</strong>
										<span>
											{forkAuctionCopy.initiallyDepositedLead}
											<CurrencyValue value={deposit.amountAttoRep} suffix={commonCopy.rep} />
										</span>
										<span>
											{claimAmount === undefined ? (
												forkAuctionCopy.worthNowPendingFinalSettlement
											) : (
												<>
													{forkAuctionCopy.worthNowLead}
													<CurrencyValue value={claimAmount} suffix={commonCopy.rep} />
												</>
											)}
										</span>
									</span>
								</label>
								{deposit.claimCheckpoint?.ready === false || deposit.claimCheckpoint?.complete === true ? (
									<div className='actions'>
										{renderPreparationAction?.({
											outcome: side.key,
											parentDepositIndex: deposit.parentDepositIndex,
											identity: deposit.claimIdentity,
											settlementGuardMessage: (() => {
												if (deposit.claimIdentity === undefined) return forkAuctionCopy.inheritedClaimIdentityUnavailable
												if (!resolved) return forkAuctionCopy.forkDepositSettlementAvailabilityDetail
												if (deposit.claimCheckpoint.ready) return forkAuctionCopy.inheritedClaimPreparationComplete
												if (!isFinalClaimCheckpointBatch(deposit.claimCheckpoint)) return forkAuctionCopy.inheritedClaimFinalBatchRequired
												return undefined
											})(),
											ready: deposit.claimCheckpoint.ready,
											progress: deposit.claimCheckpoint.ready ? forkAuctionCopy.inheritedClaimPreparationComplete : forkAuctionCopy.formatClaimPreparationProgress(deposit.claimCheckpoint.pendingSteps.toString()),
										})}
									</div>
								) : undefined}
								<details className='escalation-selection-details'>
									<summary>{commonCopy.technicalDetails}</summary>
									<span>
										{forkAuctionCopy.importedEntryDepthLead}
										<CurrencyValue value={deposit.cumulativeAmountAttoRep} suffix={commonCopy.rep} />
									</span>
								</details>
							</div>
						)
					})}
				</div>
				{paginationSummary === undefined ? undefined : (
					<PaginationControls
						hasNextPage={hasNextPage}
						hasPreviousPage={hasPreviousPage}
						nextLabel={forkAuctionCopy.nextParentDeposits}
						onNextPage={() => setPageIndex(currentPageIndex => currentPageIndex + 1)}
						onPreviousPage={() => setPageIndex(currentPageIndex => Math.max(0, currentPageIndex - 1))}
						previousLabel={forkAuctionCopy.previousParentDeposits}
						summary={paginationSummary}
					/>
				)}
			</div>
			<div className='actions'>
				{renderSettlementAction({
					guardMessage: settlementGuardMessage,
					outcome: side.key,
					sideLabel: side.label,
				})}
			</div>
		</SectionBlock>
	)
}

export function ImportedForkSettlementSection({ activeReportingDetails, disabled, onDepositSelectionChange, renderPreparationAction, renderSettlementAction, resolved, selectedDepositIndexesByOutcome, sides, winningOutcome }: ImportedForkSettlementSectionProps) {
	const settleableSides = resolved && winningOutcome !== undefined ? sides.filter(side => side.key === winningOutcome) : sides
	if (settleableSides.length === 0) return undefined

	return (
		<SectionBlock density='compact' title={forkAuctionCopy.settleForkCarriedEscalationDeposits} variant='embedded'>
			<UserMessage className='detail' detail={forkAuctionCopy.importedDepositSettlementDetail} expandableDetail={{ label: commonCopy.technicalDetails, content: forkAuctionCopy.escalationAuctionHaircutDetail }} />
			{settleableSides.map(side => (
				<ImportedForkSettlementSide
					activeReportingDetails={activeReportingDetails}
					disabled={disabled}
					key={side.key}
					onDepositSelectionChange={onDepositSelectionChange}
					renderPreparationAction={renderPreparationAction}
					renderSettlementAction={renderSettlementAction}
					resolved={resolved}
					selectedDepositIndexes={selectedDepositIndexesByOutcome[side.key]}
					side={side}
				/>
			))}
		</SectionBlock>
	)
}
