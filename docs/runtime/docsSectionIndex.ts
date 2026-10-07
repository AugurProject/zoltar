// Function declarations only: the bundled runtime loads as a classic script, so its helpers become page globals.

/** A section's pages in manifest order. */
export function docsSectionPages(data: StatoblastDocumentationData, sectionId: string): StatoblastDocumentationPage[] {
	return data.pages.filter(page => page.section === sectionId)
}

/** A section's pages grouped by topic in first-appearance order: the order the sidebar, the pager, and the landing index share. */
export function docsTopicGroups(data: StatoblastDocumentationData, sectionId: string): Map<string, StatoblastDocumentationPage[]> {
	const topics = new Map<string, StatoblastDocumentationPage[]>()
	for (const page of docsSectionPages(data, sectionId)) {
		const pages = topics.get(page.topic) ?? []
		pages.push(page)
		topics.set(page.topic, pages)
	}
	return topics
}

function docsIndexElement<K extends keyof HTMLElementTagNameMap>(name: K, className: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(name)
	if (className !== '') node.className = className
	if (text !== undefined) node.textContent = text
	return node
}

/**
 * The landing page's links are where to start; under them every section lists all of its pages, grouped as in the sidebar,
 * so a section link (such as the breadcrumb's) never lands on a subset. The section the URL fragment names opens its list.
 */
export function appendLandingSectionIndexes(data: StatoblastDocumentationData, pageUrl: (path: string) => string): void {
	for (const section of data.sections) {
		const container = document.getElementById(section.id)
		const pages = docsSectionPages(data, section.id)
		if (container === null || container.tagName !== 'SECTION' || pages.length === 0) continue
		const index = docsIndexElement('details', 'docs-section-index')
		index.open = location.hash === `#${section.id}`
		index.append(docsIndexElement('summary', '', `All ${pages.length} pages in ${section.title}`))
		for (const [topic, topicPages] of docsTopicGroups(data, section.id)) {
			const list = docsIndexElement('ul', 'docs-section-index-list')
			for (const page of topicPages) {
				const link = docsIndexElement('a', '', page.title)
				link.href = pageUrl(page.path)
				const item = docsIndexElement('li', '')
				item.append(link)
				list.append(item)
			}
			index.append(docsIndexElement('p', 'docs-section-index-topic', topic), list)
		}
		container.append(index)
	}
}
