import { useEffect, useRef } from 'preact/hooks'

type AppPageHeadingProps = {
	mainElementId?: string
	formatDocumentTitle: (pageTitle: string) => string
	pageTitle: string
}

export function AppPageHeading({ mainElementId = 'app-content', formatDocumentTitle, pageTitle }: AppPageHeadingProps) {
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
		if (!wasHistoryTraversal) document.getElementById(mainElementId)?.scrollIntoView({ block: 'start' })
		heading.focus({ preventScroll: true })
	}, [formatDocumentTitle, mainElementId, pageTitle])

	return (
		<h1 ref={headingRef} className='visually-hidden' tabIndex={-1}>
			{pageTitle}
		</h1>
	)
}
