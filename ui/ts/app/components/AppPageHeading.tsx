import { useEffect } from 'preact/hooks'
import { formatAppDocumentTitle } from '../lib/appPageTitle.js'

type AppPageHeadingProps = {
	pageTitle: string
}

export function AppPageHeading({ pageTitle }: AppPageHeadingProps) {
	useEffect(() => {
		document.title = formatAppDocumentTitle(pageTitle)
	}, [pageTitle])

	return <h1 className='visually-hidden'>{pageTitle}</h1>
}
