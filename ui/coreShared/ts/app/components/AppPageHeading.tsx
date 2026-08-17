import { useEffect, useRef } from 'preact/hooks'
import { formatAppDocumentTitle } from '../lib/appPageTitle.js'

type AppPageHeadingProps = {
	pageTitle: string
}

export function AppPageHeading({ pageTitle }: AppPageHeadingProps) {
	const headingRef = useRef<HTMLHeadingElement>(null)
	const previousPageTitleRef = useRef(pageTitle)
	const historyTraversalUrlRef = useRef<string | undefined>()

	useEffect(() => {
		const noteHistoryTraversal = () => {
			historyTraversalUrlRef.current = window.location.href
		}
		window.addEventListener('popstate', noteHistoryTraversal)
		return () => window.removeEventListener('popstate', noteHistoryTraversal)
	}, [])

	useEffect(() => {
		document.title = formatAppDocumentTitle(pageTitle)
		if (previousPageTitleRef.current === pageTitle) return
		previousPageTitleRef.current = pageTitle
		const heading = headingRef.current
		if (heading === null) return

		const wasHistoryTraversal = historyTraversalUrlRef.current === window.location.href
		historyTraversalUrlRef.current = undefined
		if (!wasHistoryTraversal) document.getElementById('app-content')?.scrollIntoView({ block: 'start' })
		heading.focus({ preventScroll: true })
	}, [pageTitle])

	return (
		<h1 ref={headingRef} className='visually-hidden' tabIndex={-1}>
			{pageTitle}
		</h1>
	)
}
