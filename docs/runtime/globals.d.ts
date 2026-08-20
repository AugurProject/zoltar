interface StatoblastDocumentationSection {
	id: string
	title: string
}

interface StatoblastDocumentationPage {
	path: string
	section: string
	topic: string
	title: string
	summary: string
}

interface StatoblastDocumentationData {
	sections: StatoblastDocumentationSection[]
	pages: StatoblastDocumentationPage[]
}

interface StatoblastDocumentationSearchEntry {
	fragment: string
	heading: string
	keywords: string[]
	path: string
	sectionTitle: string
	summary: string
	text: string
	title: string
	topic: string
	weight: number
}

interface Window {
	statoblastDocs?: unknown
	statoblastDocsSearch?: unknown
}
