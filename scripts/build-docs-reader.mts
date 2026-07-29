import assert from 'node:assert/strict'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Element, Node, Window } from 'happy-dom'
import { markdownHeadingIds } from './docs-markdown-anchors.mts'

const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputPath = path.join(repositoryRoot, 'docs/docsReaderMarkdown.js')
const readerShellPaths = new Set(['documentation.html'])

type ReaderSearchSection = {
	id: string
	kind: 'section' | 'tool'
	text: string
	title: string
}

type ReaderSearchEntry = {
	sections: ReaderSearchSection[]
	text: string
}

function normalizedElementText(content: string): string {
	return content.replace(/\s+/g, ' ').trim()
}

function isElementNode(node: Node): node is Element {
	return node.nodeType === 1
}

function searchText(element: Element, excludeInteractiveTools = false): string {
	const clone = element.cloneNode(true)
	if (!isElementNode(clone)) return ''
	const excludedSelectors = ['script', 'style', 'nav', '.sidebar', '.skip-link']
	if (excludeInteractiveTools) excludedSelectors.push('.interactive-example[id]')
	for (const excluded of Array.from(clone.querySelectorAll(excludedSelectors.join(', ')))) {
		excluded.remove()
	}
	return normalizedElementText(clone.textContent ?? '')
}

function headingSectionText(heading: Element): string {
	const fragments: string[] = []
	let current: Element | null = heading
	while (current !== null) {
		if (current !== heading && current.tagName.toLowerCase() === 'h2') break
		fragments.push(searchText(current, true))
		current = current.nextElementSibling
	}
	return normalizedElementText(fragments.join(' '))
}

function buildSearchEntry(relativePath: string, html: string): ReaderSearchEntry {
	const pageWindow = new Window()
	pageWindow.document.write(html)
	pageWindow.document.close()
	const searchRoot = pageWindow.document.querySelector('main, article') ?? pageWindow.document.body
	const sections: ReaderSearchSection[] = []
	const sectionIds = new Set<string>()
	const indexedToolIds = new Set<string>()

	for (const [index, heading] of Array.from(searchRoot.querySelectorAll('h2')).entries()) {
		const title = normalizedElementText(heading.textContent ?? '') || `Section ${index + 1}`
		const containingSection = heading.closest('section[id], article[id]')
		const id = heading.id || containingSection?.id
		assert(id !== undefined && id.length > 0, `${relativePath} h2 "${title}" needs a stable source fragment id`)
		assert(!sectionIds.has(id), `${relativePath} h2 "${title}" reuses indexed fragment #${id}`)
		const target = pageWindow.document.getElementById(id)
		assert(target !== null, `${relativePath} h2 "${title}" indexes missing source fragment #${id}`)
		sectionIds.add(id)
		const kind = target.matches('.interactive-example[id]') ? 'tool' : 'section'
		let text: string
		if (kind === 'tool') {
			text = searchText(target)
		} else if (containingSection === null) {
			text = headingSectionText(heading)
		} else {
			text = searchText(containingSection, true)
		}
		if (kind === 'tool') indexedToolIds.add(id)
		sections.push({ id, kind, text, title })
	}

	for (const [index, tool] of Array.from(searchRoot.querySelectorAll('.interactive-example[id]')).entries()) {
		const id = tool.id
		if (id.length === 0 || indexedToolIds.has(id)) continue
		const title = normalizedElementText(tool.querySelector('summary')?.textContent ?? tool.getAttribute('aria-label') ?? '') || `Interactive tool ${index + 1}`
		assert(pageWindow.document.getElementById(id) === tool, `${relativePath} tool "${title}" indexes missing source fragment #${id}`)
		sections.push({ id, kind: 'tool', text: searchText(tool), title })
	}

	const sourceOrder = new Map<string, number>()
	for (const [index, target] of [searchRoot, ...Array.from(searchRoot.querySelectorAll('[id]'))].entries()) {
		if (target.id.length > 0 && !sourceOrder.has(target.id)) sourceOrder.set(target.id, index)
	}
	const targetOrder = (section: ReaderSearchSection) => {
		const order = sourceOrder.get(section.id)
		assert(order !== undefined, `${relativePath} indexed fragment #${section.id} is missing from source order`)
		return order
	}
	const orderedSections = sections.toSorted((left, right) => targetOrder(left) - targetOrder(right))
	sections.sort((left, right) => targetOrder(left) - targetOrder(right))
	assert.deepEqual(
		sections.map(section => section.id),
		orderedSections.map(section => section.id),
		`${relativePath} indexed sections and tools must preserve source order`,
	)

	const text = searchText(searchRoot)
	pageWindow.close()
	assert(text.length > 0, `${relativePath} must provide searchable reader text`)
	return { sections, text }
}

async function collectReaderDocumentPaths(): Promise<string[]> {
	const runtime = await readFile(path.join(repositoryRoot, 'docs/docsReader.js'), 'utf8')
	assert(runtime.includes("frame.loading = 'lazy'"), 'docs reader frames must load on demand')
	assert(!runtime.includes("frame.loading = 'eager'"), 'docs reader must not eagerly load the full corpus')
	assert(runtime.includes('window.docsReaderSearchIndex'), 'docs reader must search the generated full-corpus index')
	const documentPaths = Array.from(runtime.matchAll(/\n\s+path: '([^']+\.(?:html|md))',/g), match => match[1]).filter(path => path !== undefined)
	assert(documentPaths.length > 0, 'docs/docsReader.js must declare at least one reader document')
	assert.equal(new Set(documentPaths).size, documentPaths.length, 'docs/docsReader.js reader document paths must be unique')

	const docsDirectoryEntries = await readdir(path.join(repositoryRoot, 'docs'), { withFileTypes: true })
	const sourceDocumentPaths = docsDirectoryEntries
		.filter(entry => entry.isFile() && /\.(?:html|md)$/.test(entry.name) && !readerShellPaths.has(entry.name))
		.map(entry => entry.name)
		.toSorted()
	assert.deepEqual(documentPaths.toSorted(), sourceDocumentPaths, 'docs/docsReader.js reader documents must exactly match the top-level documentation corpus')

	const page = await readFile(path.join(repositoryRoot, 'docs/documentation.html'), 'utf8')
	const pageWindow = new Window()
	pageWindow.document.write(page)
	pageWindow.document.close()
	const pageTitles = Array.from(pageWindow.document.querySelectorAll('head > title'), title => normalizedElementText(title.textContent))
	const pageHeadings = Array.from(pageWindow.document.querySelectorAll('body h1'), heading => normalizedElementText(heading.textContent))
	const initialStatusText = normalizedElementText(pageWindow.document.querySelector('[data-search-status]')?.textContent ?? '')
	const initialStatusCount = Number(/^(\d+) documents$/.exec(initialStatusText)?.[1])
	const browserTitle = normalizedElementText(pageWindow.document.title)
	pageWindow.close()
	assert.deepEqual(pageTitles, ['Statoblast documentation'], 'documentation must have one exact Statoblast browser title')
	assert.equal(browserTitle, 'Statoblast documentation', 'documentation browser title must render exactly as Statoblast documentation')
	assert.deepEqual(pageHeadings, ['Statoblast documentation'], 'documentation must have one exact outer Statoblast heading')
	assert.equal(initialStatusCount, documentPaths.length, 'documentation initial search status must match the reader corpus')

	const noscript = /<noscript>([\s\S]+)<\/noscript>/.exec(page)?.[1]
	assert(noscript !== undefined, 'docs/documentation.html must provide a no-JavaScript document list')
	const fallbackPaths = Array.from(noscript.matchAll(/href="\.\/([^"]+\.(?:html|md))"/g), match => match[1]).filter(path => path !== undefined)
	assert.deepEqual(fallbackPaths.toSorted(), documentPaths.toSorted(), 'documentation no-JavaScript links must match the reader corpus')
	return documentPaths
}

async function renderMarkdownDocument(relativePath: string): Promise<readonly [string, string]> {
	const markdown = await readFile(path.join(repositoryRoot, relativePath), 'utf8')
	const headingIds = markdownHeadingIds(markdown)
	let headingIndex = 0
	let renderedHtml = Bun.markdown.html(markdown)
	let insertedCharacterCount = 0
	for (const match of renderedHtml.matchAll(/<h([1-6])([^>]*)>/g)) {
		const headingId = headingIds[headingIndex]
		if (headingId === undefined) {
			throw new Error(`${relativePath} rendered more headings than its Markdown source`)
		}
		const openingTag = match[0]
		const attributes = match[2]
		const matchIndex = match.index
		if (attributes === undefined) {
			throw new Error(`${relativePath} rendered an unreadable heading tag`)
		}
		if (/\sid=/.test(attributes)) {
			throw new Error(`${relativePath} rendered an unexpected heading id before reader generation`)
		}
		headingIndex += 1
		const insertionIndex = matchIndex + openingTag.length + insertedCharacterCount - 1
		const idAttribute = ` id="${headingId}"`
		renderedHtml = `${renderedHtml.slice(0, insertionIndex)}${idAttribute}${renderedHtml.slice(insertionIndex)}`
		insertedCharacterCount += idAttribute.length
	}

	if (headingIndex !== headingIds.length) {
		throw new Error(`${relativePath} rendered ${headingIndex} of ${headingIds.length} Markdown headings`)
	}
	const renderedHeadingIds = Array.from(renderedHtml.matchAll(/<h[1-6][^>]*\sid="([^"]+)"/g), match => match[1])
	assert.deepEqual(renderedHeadingIds, headingIds, `${relativePath} reader heading ids must match validated Markdown anchors`)
	return [path.basename(relativePath), renderedHtml]
}

const documentPaths = await collectReaderDocumentPaths()
const markdownPaths = documentPaths.filter(documentPath => documentPath.endsWith('.md')).map(documentPath => `docs/${documentPath}`)
const renderedDocuments = Object.fromEntries(await Promise.all(markdownPaths.map(renderMarkdownDocument)))
const searchEntries = Object.fromEntries(
	await Promise.all(
		documentPaths.map(async documentPath => {
			const relativePath = `docs/${documentPath}`
			const html = documentPath.endsWith('.md') ? renderedDocuments[documentPath] : await readFile(path.join(repositoryRoot, relativePath), 'utf8')
			assert(html !== undefined, `${relativePath} must have rendered reader content`)
			return [documentPath, buildSearchEntry(relativePath, html)] as const
		}),
	),
)

const output = `// Generated by scripts/build-docs-reader.mts. Do not edit directly.\nwindow.docsReaderMarkdown = ${JSON.stringify(renderedDocuments)}\nwindow.docsReaderSearchIndex = ${JSON.stringify(searchEntries)}\n`
const checkOnly = process.argv.includes('--check')

if (checkOnly) {
	const current = await readFile(outputPath, 'utf8').catch(() => '')
	if (current !== output) {
		throw new Error('docs/docsReaderMarkdown.js is stale; run bun run docs:build-reader')
	}
} else {
	await writeFile(outputPath, output)
}
