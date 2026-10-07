import * as commonCopy from '../copy/common.js'
import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { LoadingText } from './LoadingText.js'

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
	/** Position such as `Page 2 of 5`; it is a polite live region so a page change is announced. */
	summary?: ComponentChildren
}

type PaginationControl = 'previous' | 'next' | 'loadMore'

export function PaginationControls({ hasNextPage = false, hasPreviousPage = false, loading = false, loadMoreLabel = commonCopy.loadMore, nextLabel = commonCopy.nextPage, onLoadMore, onNextPage, onPreviousPage, previousLabel = commonCopy.previousPage, summary }: PaginationControlsProps) {
	// The pressed control shows the pending state, so a load in flight never looks like the end of the list.
	const [pressedControl, setPressedControl] = useState<PaginationControl | undefined>(undefined)
	useEffect(() => {
		if (!loading) setPressedControl(undefined)
	}, [loading])
	const hasPageNavigation = onPreviousPage !== undefined || onNextPage !== undefined
	const hasLoadMore = onLoadMore !== undefined
	if (!hasPageNavigation && !hasLoadMore && summary === undefined) return undefined
	// A single page has nothing to navigate, so the controls stay out of the way until more pages exist.
	// While a page is loading the page count is unknown, so the controls stay in place instead of disappearing mid-reload.
	if (!hasLoadMore && !hasNextPage && !hasPreviousPage && !loading) return undefined

	// The spinner is silent: the summary status announces the page that arrives.
	const renderLabel = (control: PaginationControl, label: ComponentChildren) => (loading && pressedControl === control ? <LoadingText announce={false}>{label}</LoadingText> : label)
	const press = (control: PaginationControl, action: () => void) => () => {
		setPressedControl(control)
		action()
	}

	return (
		<div className='actions'>
			{summary === undefined ? undefined : (
				<span aria-live='polite' className='detail'>
					{summary}
				</span>
			)}
			{onPreviousPage === undefined ? undefined : (
				<button className='secondary' type='button' onClick={press('previous', onPreviousPage)} disabled={!hasPreviousPage || loading}>
					{renderLabel('previous', previousLabel)}
				</button>
			)}
			{onNextPage === undefined ? undefined : (
				<button className='secondary' type='button' onClick={press('next', onNextPage)} disabled={!hasNextPage || loading}>
					{renderLabel('next', nextLabel)}
				</button>
			)}
			{onLoadMore === undefined ? undefined : (
				<button className='secondary' type='button' onClick={press('loadMore', onLoadMore)} disabled={!hasLoadMore || !hasNextPage || loading}>
					{renderLabel('loadMore', loadMoreLabel)}
				</button>
			)}
		</div>
	)
}
