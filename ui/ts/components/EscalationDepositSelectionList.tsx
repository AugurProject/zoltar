import type { ComponentChildren } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, resolvePaginationPageIndex } from '../lib/pagination.js'
import type { EscalationDeposit } from '../types/contracts.js'
import { PaginationControls } from './PaginationControls.js'

const ESCALATION_DEPOSIT_SELECTION_PAGE_SIZE = 25

type EscalationDepositSelectionItem = {
	deposit: EscalationDeposit
	details: ComponentChildren[]
}

type EscalationDepositSelectionListProps = {
	disabled?: boolean
	items: EscalationDepositSelectionItem[]
	onSelectionChange: (selectedDepositIndexes: bigint[]) => void
	selectedDepositIndexes: bigint[]
}

export function EscalationDepositSelectionList({ disabled = false, items, onSelectionChange, selectedDepositIndexes }: EscalationDepositSelectionListProps) {
	const [pageIndex, setPageIndex] = useState(0)
	const pageCount = getPaginationPageCount(BigInt(items.length), ESCALATION_DEPOSIT_SELECTION_PAGE_SIZE)
	const resolvedPageIndex = resolvePaginationPageIndex(pageIndex, pageCount)
	const hasNextPage = getHasNextPaginationPage(resolvedPageIndex, pageCount)
	const hasPreviousPage = resolvedPageIndex > 0
	const pageStartIndex = resolvedPageIndex * ESCALATION_DEPOSIT_SELECTION_PAGE_SIZE
	const pageEndIndex = Math.min(items.length, pageStartIndex + ESCALATION_DEPOSIT_SELECTION_PAGE_SIZE)
	const visibleItems = useMemo(() => items.slice(pageStartIndex, pageEndIndex), [items, pageEndIndex, pageStartIndex])
	const paginationSummary = items.length > ESCALATION_DEPOSIT_SELECTION_PAGE_SIZE ? `Showing deposits ${(pageStartIndex + 1).toString()}-${pageEndIndex.toString()} of ${items.length.toString()}. ${formatPaginationSummary(resolvedPageIndex, pageCount) ?? ''}` : undefined

	useEffect(() => {
		if (resolvedPageIndex !== pageIndex) setPageIndex(resolvedPageIndex)
	}, [pageIndex, resolvedPageIndex])

	return (
		<>
			<div className='withdraw-deposit-list'>
				{visibleItems.map(item => {
					const { deposit, details } = item
					const isChecked = selectedDepositIndexes.includes(deposit.depositIndex)

					return (
						<label key={deposit.depositIndex.toString()} className='withdraw-deposit-option'>
							<input
								type='checkbox'
								checked={isChecked}
								disabled={disabled}
								onChange={event => {
									const nextSelectedDepositIndexes = event.currentTarget.checked ? [...selectedDepositIndexes, deposit.depositIndex] : selectedDepositIndexes.filter(index => index !== deposit.depositIndex)
									onSelectionChange(nextSelectedDepositIndexes)
								}}
							/>
							<span className='withdraw-deposit-copy'>
								<strong>Deposit #{deposit.depositIndex.toString()}</strong>
								{details.map((detail, detailIndex) => (
									<span key={`${deposit.depositIndex.toString()}:${detailIndex.toString()}`}>{detail}</span>
								))}
							</span>
						</label>
					)
				})}
			</div>
			{paginationSummary === undefined ? undefined : (
				<PaginationControls
					hasNextPage={hasNextPage}
					hasPreviousPage={hasPreviousPage}
					nextLabel='Next Deposits'
					onNextPage={() => setPageIndex(currentPageIndex => currentPageIndex + 1)}
					onPreviousPage={() => setPageIndex(currentPageIndex => Math.max(0, currentPageIndex - 1))}
					previousLabel='Previous Deposits'
					summary={paginationSummary}
				/>
			)}
		</>
	)
}
