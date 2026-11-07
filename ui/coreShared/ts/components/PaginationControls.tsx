import * as commonCopy from '../copy/common.js'
import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { LoadingText } from './LoadingText.js'
import { useFocusRetainingDisabled } from '../hooks/useFocusRetainingDisabled.js'

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

/** A pager button that keeps keyboard focus while its own load runs or after it reaches the end of the list. */
function PaginationButton({ busy, children, disabled, onClick }: { busy: boolean; children: ComponentChildren; disabled: boolean; onClick: () => void }) {
	const { buttonProps, guardClick } = useFocusRetainingDisabled(disabled)
	return (
		<button className='secondary' type='button' aria-busy={busy} {...buttonProps} onClick={guardClick(onClick)}>
			{children}
		</button>
	)
}

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
	const isPressed = (control: PaginationControl) => loading && pressedControl === control
	const renderLabel = (control: PaginationControl, label: ComponentChildren) => (isPressed(control) ? <LoadingText announce={false}>{label}</LoadingText> : label)
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
				<PaginationButton busy={isPressed('previous')} disabled={!hasPreviousPage || loading} onClick={press('previous', onPreviousPage)}>
					{renderLabel('previous', previousLabel)}
				</PaginationButton>
			)}
			{onNextPage === undefined ? undefined : (
				<PaginationButton busy={isPressed('next')} disabled={!hasNextPage || loading} onClick={press('next', onNextPage)}>
					{renderLabel('next', nextLabel)}
				</PaginationButton>
			)}
			{onLoadMore === undefined ? undefined : (
				<PaginationButton busy={isPressed('loadMore')} disabled={!hasLoadMore || !hasNextPage || loading} onClick={press('loadMore', onLoadMore)}>
					{renderLabel('loadMore', loadMoreLabel)}
				</PaginationButton>
			)}
		</div>
	)
}
