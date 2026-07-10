import type { ComponentChildren } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { CurrencyValue } from './CurrencyValue.js'
import { PaginationControls } from './PaginationControls.js'
import { SectionBlock } from './SectionBlock.js'
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, resolvePaginationPageIndex } from '../lib/pagination.js'
import { getImportedEscalationDepositClaimAmount } from '../lib/reportingDomain.js'
import type { ActiveReportingDetails, EscalationSide, ReportingOutcomeKey } from '../types/contracts.js'
import {
	UI_STRING_FORK_CARRIED_ESCALATION_DEPOSITS_CAN_BE_SETTLED_AFTER_CHILD_POOL_FINALIZES,
	UI_STRING_IMPORTED_ENTRY_DEPTH,
	UI_STRING_IMPORTED_FROM_PARENT_UNIVERSE,
	UI_STRING_IMPORTED_FROM_THE_PARENT_UNIVERSE_SETTLE_THESE_POSITIONS_IN_THIS_CHILD_POOL,
	UI_STRING_INITIALLY_DEPOSITED_PREFIX,
	UI_STRING_NEXT_PARENT_DEPOSITS,
	UI_STRING_PARENT_DEPOSIT_NUMBER,
	UI_STRING_PREVIOUS_PARENT_DEPOSITS,
	UI_STRING_REP,
	UI_STRING_SETTLE_FORK_CARRIED_ESCALATION_DEPOSITS,
	UI_STRING_WORTH_NOW_PENDING_FINAL_SETTLEMENT,
	UI_STRING_WORTH_NOW_PREFIX,
	UI_TEMPLATE_SELECT_AT_LEAST_ONE_VALUE_FORK_CARRIED_DEPOSIT_TO_SETTLE,
	UI_TEMPLATE_IMPORTED_FORK_DEPOSIT_PAGE_SUMMARY,
} from '../lib/uiStrings.js'

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
		side.importedUserDeposits.length > IMPORTED_FORK_SETTLEMENT_PAGE_SIZE && paginationPageSummary !== undefined ? UI_TEMPLATE_IMPORTED_FORK_DEPOSIT_PAGE_SUMMARY((pageStartIndex + 1).toString(), pageEndIndex.toString(), side.importedUserDeposits.length.toString(), paginationPageSummary) : undefined
	const settlementGuardMessage = (() => {
		if (!resolved) return UI_STRING_FORK_CARRIED_ESCALATION_DEPOSITS_CAN_BE_SETTLED_AFTER_CHILD_POOL_FINALIZES
		if (selectedDepositIndexes.length === 0) return UI_TEMPLATE_SELECT_AT_LEAST_ONE_VALUE_FORK_CARRIED_DEPOSIT_TO_SETTLE(side.label.toLowerCase())
		return undefined
	})()

	useEffect(() => {
		if (resolvedPageIndex !== pageIndex) setPageIndex(resolvedPageIndex)
	}, [pageIndex, resolvedPageIndex])

	return (
		<SectionBlock density='compact' headingLevel={4} key={side.key} title={side.label} variant='embedded'>
			<div className='field'>
				<span>{UI_STRING_IMPORTED_FROM_PARENT_UNIVERSE}</span>
				<div className='escalation-selection-list'>
					{visibleDeposits.map(deposit => {
						const selected = selectedDepositIndexes.includes(deposit.parentDepositIndex)
						const claimAmount = getImportedEscalationDepositClaimAmount(activeReportingDetails, side.key, deposit)
						return (
							<label className='escalation-selection-item' key={deposit.parentDepositIndex.toString()}>
								<input checked={selected} disabled={disabled} onChange={event => onDepositSelectionChange(side.key, deposit.parentDepositIndex, event.currentTarget.checked)} type='checkbox' />
								<div className='escalation-selection-item-copy'>
									<strong>
										{UI_STRING_PARENT_DEPOSIT_NUMBER}
										{deposit.parentDepositIndex.toString()}
									</strong>
									<span>
										{UI_STRING_INITIALLY_DEPOSITED_PREFIX}
										<CurrencyValue value={deposit.amount} suffix={UI_STRING_REP} />
									</span>
									<span>
										{claimAmount === undefined ? (
											UI_STRING_WORTH_NOW_PENDING_FINAL_SETTLEMENT
										) : (
											<>
												{UI_STRING_WORTH_NOW_PREFIX}
												<CurrencyValue value={claimAmount} suffix={UI_STRING_REP} />
											</>
										)}
									</span>
									<span>
										{UI_STRING_IMPORTED_ENTRY_DEPTH}
										<CurrencyValue value={deposit.cumulativeAmount} suffix={UI_STRING_REP} />
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
						nextLabel={UI_STRING_NEXT_PARENT_DEPOSITS}
						onNextPage={() => setPageIndex(currentPageIndex => currentPageIndex + 1)}
						onPreviousPage={() => setPageIndex(currentPageIndex => Math.max(0, currentPageIndex - 1))}
						previousLabel={UI_STRING_PREVIOUS_PARENT_DEPOSITS}
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
		<SectionBlock density='compact' title={UI_STRING_SETTLE_FORK_CARRIED_ESCALATION_DEPOSITS}>
			<p className='detail'>{UI_STRING_IMPORTED_FROM_THE_PARENT_UNIVERSE_SETTLE_THESE_POSITIONS_IN_THIS_CHILD_POOL}</p>
			{resolved ? undefined : <p className='detail'>{UI_STRING_FORK_CARRIED_ESCALATION_DEPOSITS_CAN_BE_SETTLED_AFTER_CHILD_POOL_FINALIZES}</p>}
			{sides.map(side => (
				<ImportedForkSettlementSide activeReportingDetails={activeReportingDetails} disabled={disabled} key={side.key} onDepositSelectionChange={onDepositSelectionChange} renderSettlementAction={renderSettlementAction} resolved={resolved} selectedDepositIndexes={selectedDepositIndexesByOutcome[side.key]} side={side} />
			))}
		</SectionBlock>
	)
}
