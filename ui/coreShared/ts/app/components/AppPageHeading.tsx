import { useEffect, useRef } from 'preact/hooks'

type AppPageHeadingProps = {
	formatDocumentTitle: (pageTitle: string) => string
	pageTitle: string
}

export function AppPageHeading({ formatDocumentTitle, pageTitle }: AppPageHeadingProps) {
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
		document.title = formatDocumentTitle(pageTitle)
		if (previousPageTitleRef.current === pageTitle) return
		previousPageTitleRef.current = pageTitle
		const heading = headingRef.current
		if (heading === null) return

		const wasHistoryTraversal = historyTraversalUrlRef.current === window.location.href
		historyTraversalUrlRef.current = undefined
		if (!wasHistoryTraversal) document.getElementById('app-content')?.scrollIntoView({ block: 'start' })
		heading.focus({ preventScroll: true })
	}, [formatDocumentTitle, pageTitle])

	return (
		<h1 ref={headingRef} className='visually-hidden' tabIndex={-1}>
			{pageTitle}
		</h1>
	)
}
