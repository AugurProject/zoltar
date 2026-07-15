import * as commonCopy from '../copy/common.js'
import * as forkAuctionCopy from '../copy/forkAuction.js'
import type { ComponentChildren } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { CurrencyValue } from './CurrencyValue.js'
import { PaginationControls } from './PaginationControls.js'
import { SectionBlock } from './SectionBlock.js'
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, resolvePaginationPageIndex } from '../lib/pagination.js'
import { getImportedEscalationDepositClaimAmount } from '../lib/reportingDomain.js'
import type { ActiveReportingDetails, EscalationSide, ReportingOutcomeKey } from '../types/contracts.js'

const IMPORTED_FORK_SETTLEMENT_PAGE_SIZE = 25

type ImportedForkSettlementActionRenderProps = {
	guardMessage: string | undefined
	outcome: ReportingOutcomeKey
	sideLabel: string
}

type ImportedForkSettlementSectionProps = {
	activeReportingDetails: ActiveReportingDetails | undefined
	disabled: boolean
	onDepositSelectionChange: (outcome: ReportingOutcomeKey, depositIndex: bigint, checked: boolean) => void
	renderSettlementAction: (props: ImportedForkSettlementActionRenderProps) => ComponentChildren
	resolved: boolean
	selectedDepositIndexesByOutcome: Record<ReportingOutcomeKey, bigint[]>
	sides: Pick<EscalationSide, 'importedUserDeposits' | 'key' | 'label'>[]
}

type ImportedForkSettlementSideProps = {
	activeReportingDetails: ActiveReportingDetails | undefined
	disabled: boolean
	onDepositSelectionChange: (outcome: ReportingOutcomeKey, depositIndex: bigint, checked: boolean) => void
	renderSettlementAction: (props: ImportedForkSettlementActionRenderProps) => ComponentChildren
	resolved: boolean
	selectedDepositIndexes: bigint[]
	side: Pick<EscalationSide, 'importedUserDeposits' | 'key' | 'label'>
}

function ImportedForkSettlementSide({ activeReportingDetails, disabled, onDepositSelectionChange, renderSettlementAction, resolved, selectedDepositIndexes, side }: ImportedForkSettlementSideProps) {
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
		if (selectedDepositIndexes.length === 0) return forkAuctionCopy.formatDepositSelectionRequired(side.label.toLowerCase())
		return undefined
	})()

	useEffect(() => {
		if (resolvedPageIndex !== pageIndex) setPageIndex(resolvedPageIndex)
	}, [pageIndex, resolvedPageIndex])

	return (
		<SectionBlock density='compact' headingLevel={4} key={side.key} title={side.label} variant='embedded'>
			<div className='field'>
				<span>{forkAuctionCopy.importedFromParentUniverse}</span>
				<div className='escalation-selection-list'>
					{visibleDeposits.map(deposit => {
						const selected = selectedDepositIndexes.includes(deposit.parentDepositIndex)
						const claimAmount = getImportedEscalationDepositClaimAmount(activeReportingDetails, side.key, deposit)
						return (
							<label className='escalation-selection-item' key={deposit.parentDepositIndex.toString()}>
								<input checked={selected} disabled={disabled} onChange={event => onDepositSelectionChange(side.key, deposit.parentDepositIndex, event.currentTarget.checked)} type='checkbox' />
								<div className='escalation-selection-item-copy'>
									<strong>
										{forkAuctionCopy.parentDepositNumber}
										{deposit.parentDepositIndex.toString()}
									</strong>
									<span>
										{forkAuctionCopy.initiallyDepositedLead}
										<CurrencyValue value={deposit.amount} suffix={commonCopy.rep} />
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
									<span>
										{forkAuctionCopy.importedEntryDepthLead}
										<CurrencyValue value={deposit.cumulativeAmount} suffix={commonCopy.rep} />
									</span>
								</div>
							</label>
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

export function ImportedForkSettlementSection({ activeReportingDetails, disabled, onDepositSelectionChange, renderSettlementAction, resolved, selectedDepositIndexesByOutcome, sides }: ImportedForkSettlementSectionProps) {
	if (sides.length === 0) return undefined

	return (
		<SectionBlock density='compact' title={forkAuctionCopy.settleForkCarriedEscalationDeposits}>
			<p className='detail'>{forkAuctionCopy.importedDepositSettlementDetail}</p>
			{resolved ? undefined : <p className='detail'>{forkAuctionCopy.forkDepositSettlementAvailabilityDetail}</p>}
			{sides.map(side => (
				<ImportedForkSettlementSide activeReportingDetails={activeReportingDetails} disabled={disabled} key={side.key} onDepositSelectionChange={onDepositSelectionChange} renderSettlementAction={renderSettlementAction} resolved={resolved} selectedDepositIndexes={selectedDepositIndexesByOutcome[side.key]} side={side} />
			))}
		</SectionBlock>
	)
}
