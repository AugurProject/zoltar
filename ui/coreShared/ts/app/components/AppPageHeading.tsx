import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import { isHistoryTraversal, subscribeToLocationChanges } from '../../navigation/historyEntries.js'

type AppPageHeadingProps = {
	formatDocumentTitle: (pageTitle: string) => string
	pageTitle: string
}

/**
 * The page's visually hidden heading, placed first in the main content. When the page changes it names the new page in
 * the document title and takes focus, so the next Tab continues into the content instead of restarting at the header.
 * A new page opens at the top; Back and Forward keep the scroll position the browser restores.
 */
export function AppPageHeading({ formatDocumentTitle, pageTitle }: AppPageHeadingProps) {
	const headingRef = useRef<HTMLHeadingElement>(null)
	const previousPageTitleRef = useRef(pageTitle)

	// Keeps Back and Forward detection running while the heading is shown, even without a route hook subscribed.
	useEffect(() => subscribeToLocationChanges(() => undefined), [])

	// A layout effect resets the scroll position before the new page paints at the previous page's offset.
	useLayoutEffect(() => {
		document.title = formatDocumentTitle(pageTitle)
		if (previousPageTitleRef.current === pageTitle) return
		previousPageTitleRef.current = pageTitle
		const heading = headingRef.current
		if (heading === null) return
		if (!isHistoryTraversal()) window.scrollTo({ top: 0 })
		heading.focus({ preventScroll: true })
	}, [formatDocumentTitle, pageTitle])

	return (
		<h1 ref={headingRef} className='visually-hidden' tabIndex={-1}>
			{pageTitle}
		</h1>
	)
}
