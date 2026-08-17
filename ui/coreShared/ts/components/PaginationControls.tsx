import * as commonCopy from '../copy/common.js'
import type { ComponentChildren } from 'preact'

type PaginationControlsProps = {
	hasNextPage?: boolean
	hasPreviousPage?: boolean
	loading?: boolean
	loadMoreLabel?: ComponentChildren
	nextLabel?: ComponentChildren
	onLoadMore?: () => void
	onNextPage?: () => void
	onPreviousPage?: () => void
	previousLabel?: ComponentChildren
	summary?: ComponentChildren
}

export function PaginationControls({ hasNextPage = false, hasPreviousPage = false, loading = false, loadMoreLabel = commonCopy.loadMore, nextLabel = commonCopy.nextPage, onLoadMore, onNextPage, onPreviousPage, previousLabel = commonCopy.previousPage, summary }: PaginationControlsProps) {
	const hasPageNavigation = onPreviousPage !== undefined || onNextPage !== undefined
	const hasLoadMore = onLoadMore !== undefined
	if (!hasPageNavigation && !hasLoadMore && summary === undefined) return undefined

	return (
		<div className='actions'>
			{summary === undefined ? undefined : <span className='detail'>{summary}</span>}
			{onPreviousPage === undefined ? undefined : (
				<button className='secondary' type='button' onClick={onPreviousPage} disabled={!hasPreviousPage || loading}>
					{previousLabel}
				</button>
			)}
			{onNextPage === undefined ? undefined : (
				<button className='secondary' type='button' onClick={onNextPage} disabled={!hasNextPage || loading}>
					{nextLabel}
				</button>
			)}
			{onLoadMore === undefined ? undefined : (
				<button className='secondary' type='button' onClick={onLoadMore} disabled={!hasLoadMore || !hasNextPage || loading}>
					{loadMoreLabel}
				</button>
			)}
		</div>
	)
}
