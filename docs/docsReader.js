const documentGroups = [
	{
		label: 'Protocol foundations',
		documents: [
			{
				path: 'statoblast-whitepaper.html',
				title: 'Statoblast whitepaper',
				description: 'The application layer, from markets and pools through resolution and migration.',
			},
			{
				path: 'zoltar-whitepaper.html',
				title: 'Zoltar whitepaper',
				description: 'Universes, question encoding, global forks, and REP splitting.',
			},
			{
				path: 'truth-auction.html',
				title: 'Truth auction',
				description: 'Auction clearing, settlement, and weak-demand loss allocation.',
			},
			{
				path: 'open-oracle-integration.html',
				title: 'OpenOracle integration',
				description: 'REP/ETH price requests, corrections, settlement, and residual risk.',
			},
			{
				path: 'liquidation.html',
				title: 'Liquidation design',
				description: 'Punitive REP seizure, chunking limits, health calculations, and incentives.',
			},
		],
	},
	{
		label: 'Safety and operations',
		documents: [
			{
				path: 'security-model.html',
				title: 'Protocol security model',
				description: 'Normative participant, market, deployment, client, and cryptographic assumptions.',
			},
			{
				path: 'invariants.html',
				title: 'Protocol invariants',
				description: 'Contract, lifecycle, cross-contract, liveness, and economic properties.',
			},
			{
				path: 'operator-reference.md',
				title: 'Operator reference',
				description: 'Launch guardrails, subsystem edge cases, and operational recovery paths.',
			},
			{
				path: 'contract-interaction-reference.md',
				title: 'Contract interaction reference',
				description: 'Transaction callers, prerequisites, effects, and emitted events.',
			},
			{
				path: 'event-stream.md',
				title: 'Event stream contract',
				description: 'Deterministic event-only indexing, replay, and reorg rollback.',
			},
		],
	},
	{
		label: 'Architecture and deployment',
		documents: [
			{
				path: 'contract-interactions.html',
				title: 'Contract interaction map',
				description: 'How deployed contracts call, deploy, and move assets between one another.',
			},
			{
				path: 'escalation-game-architecture.html',
				title: 'EscalationGame architecture',
				description: 'The Solidity module split, authority boundaries, and accounting responsibilities.',
			},
			{
				path: 'deployment-status.html',
				title: 'Deployment status oracle',
				description: 'Deployment progress bitmask semantics and the 256-step limit.',
			},
			{
				path: 'merkle-mountain-range.html',
				title: 'Merkle Mountain Range proofs',
				description: 'Carry-proof hashing, snapshot peaks, and nullifier replay protection.',
			},
		],
	},
]

const documents = documentGroups.flatMap(group => group.documents)
const documentsContainer = document.querySelector('[data-reader-documents]')
const navigation = document.querySelector('[data-reader-navigation]')
const searchInput = document.querySelector('[data-doc-search]')
const searchStatus = document.querySelector('[data-search-status]')
const emptyState = document.querySelector('[data-reader-empty]')
const clearSearchButton = document.querySelector('[data-clear-search]')
const progress = document.querySelector('[data-reading-progress]')
const chapterByPath = new Map()
const frameByPath = new Map()
const searchableTextByPath = new Map()
const pendingFragmentByPath = new Map()
const indexedPaths = new Set()
const failedPaths = new Set()

window.history.scrollRestoration = 'manual'

function pathSlug(path) {
	return path.replace(/\.(?:html|md)$/, '').replace(/[^a-z0-9]+/gi, '-')
}

function chapterId(path) {
	return `doc-${pathSlug(path)}`
}

function sourceUrl(path) {
	return new URL(path, window.location.href).href
}

function decodeFragment(fragment) {
	try {
		return decodeURIComponent(fragment)
	} catch (error) {
		if (error instanceof URIError) return undefined
		throw error
	}
}

function createNavigation() {
	if (!(navigation instanceof HTMLElement)) return

	let index = 0
	for (const group of documentGroups) {
		const groupElement = document.createElement('section')
		groupElement.className = 'reader-nav-group'

		const heading = document.createElement('h2')
		heading.textContent = group.label
		groupElement.append(heading)

		for (const documentEntry of group.documents) {
			index += 1
			const link = document.createElement('a')
			link.href = `#${chapterId(documentEntry.path)}`
			link.dataset.documentPath = documentEntry.path

			const number = document.createElement('span')
			number.textContent = String(index).padStart(2, '0')
			const title = document.createElement('strong')
			title.textContent = documentEntry.title
			link.append(number, title)
			groupElement.append(link)
		}

		navigation.append(groupElement)
	}
}

function markdownFrameSource(path, title) {
	const markdownDocuments = window.docsReaderMarkdown
	if (typeof markdownDocuments !== 'object' || markdownDocuments === null) {
		return ''
	}
	const content = markdownDocuments[path]
	if (typeof content !== 'string') return ''

	return `<!doctype html>
		<html lang="en">
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1">
				<base href="${sourceUrl(path)}">
				<title>${title}</title>
				<link rel="stylesheet" href="./shared-docs.css">
			</head>
			<body class="doc-openoracle markdown-reference">
				<main><article>${content}</article></main>
			</body>
		</html>`
}

function createChapter(documentEntry, index, groupLabel) {
	const chapter = document.createElement('section')
	chapter.className = 'reader-chapter'
	chapter.id = chapterId(documentEntry.path)
	chapter.dataset.documentPath = documentEntry.path

	const header = document.createElement('header')
	header.className = 'reader-chapter-header'

	const number = document.createElement('span')
	number.className = 'reader-chapter-number'
	number.textContent = String(index).padStart(2, '0')
	number.setAttribute('aria-hidden', 'true')

	const heading = document.createElement('div')
	heading.className = 'reader-chapter-heading'
	const category = document.createElement('p')
	category.textContent = groupLabel
	const title = document.createElement('h2')
	title.textContent = documentEntry.title
	const description = document.createElement('small')
	description.textContent = documentEntry.description
	heading.append(category, title, description)

	const sourceLink = document.createElement('a')
	sourceLink.className = 'reader-source-link'
	sourceLink.href = `./${documentEntry.path}`
	sourceLink.textContent = 'Open source ↗'
	sourceLink.target = '_blank'
	sourceLink.rel = 'noreferrer'

	header.append(number, heading, sourceLink)

	const frameWrap = document.createElement('div')
	frameWrap.className = 'reader-frame-wrap'
	frameWrap.setAttribute('aria-busy', 'true')
	const frameStatus = document.createElement('span')
	frameStatus.className = 'reader-frame-status'
	frameStatus.setAttribute('role', 'status')
	frameStatus.textContent = 'Loading document…'
	const frame = document.createElement('iframe')
	frame.className = 'reader-document-frame'
	frame.title = `${documentEntry.title} document`
	frame.dataset.documentFrame = documentEntry.path
	frame.loading = 'eager'

	frameWrap.append(frameStatus, frame)
	chapter.append(header, frameWrap)
	chapterByPath.set(documentEntry.path, chapter)
	frameByPath.set(documentEntry.path, frame)
	searchableTextByPath.set(documentEntry.path, `${documentEntry.title} ${documentEntry.description} ${groupLabel}`.toLowerCase())

	frame.addEventListener('load', () => {
		if (frame.dataset.readerSourceReady !== 'true') return
		initializeFrame(documentEntry.path, frame, frameWrap, frameStatus)
	})
	frame.addEventListener('error', () => showFrameError(documentEntry, frame, frameWrap, frameStatus))
	requestDocumentFrame(documentEntry, frame, frameWrap, frameStatus).catch(error => handleDocumentFrameFailure(error, documentEntry, frame, frameWrap, frameStatus))
	return chapter
}

async function requestDocumentFrame(documentEntry, frame, frameWrap, frameStatus) {
	delete frameWrap.dataset.loaded
	frameWrap.setAttribute('aria-busy', 'true')
	frameStatus.hidden = false
	frameStatus.textContent = 'Loading document…'
	frame.hidden = false
	frameWrap.querySelector('.reader-frame-error')?.remove()
	failedPaths.delete(documentEntry.path)
	applySearch()

	if (documentEntry.path.endsWith('.md')) {
		const source = markdownFrameSource(documentEntry.path, documentEntry.title)
		if (source.length === 0) throw new Error('Generated Markdown content is unavailable')
		frame.dataset.readerSourceReady = 'true'
		frame.srcdoc = source
		return
	}

	const response = await fetch(`./${documentEntry.path}`, { method: 'HEAD' })
	if (!response.ok) throw new Error(`Document request returned ${response.status}`)
	frame.dataset.readerSourceReady = 'true'
	frame.src = `./${documentEntry.path}`
}

function handleDocumentFrameFailure(error, documentEntry, frame, frameWrap, frameStatus) {
	if (!(error instanceof Error)) throw error
	showFrameError(documentEntry, frame, frameWrap, frameStatus)
}

function showFrameError(documentEntry, frame, frameWrap, frameStatus) {
	delete frame.dataset.readerSourceReady
	frameWrap.dataset.loaded = 'true'
	frameWrap.setAttribute('aria-busy', 'false')
	frameStatus.hidden = true
	frame.hidden = true
	indexedPaths.delete(documentEntry.path)
	failedPaths.add(documentEntry.path)
	frameWrap.querySelector('.reader-frame-error')?.remove()

	const error = document.createElement('div')
	error.className = 'reader-frame-error'
	error.setAttribute('role', 'alert')
	const title = document.createElement('strong')
	title.textContent = `${documentEntry.title} could not be loaded`
	const guidance = document.createElement('p')
	guidance.textContent = 'Check your connection and try this document again. The direct source link remains available above.'
	const retry = document.createElement('button')
	retry.type = 'button'
	retry.textContent = 'Retry document'
	retry.addEventListener('click', () => {
		requestDocumentFrame(documentEntry, frame, frameWrap, frameStatus).catch(error => handleDocumentFrameFailure(error, documentEntry, frame, frameWrap, frameStatus))
	})
	error.append(title, guidance, retry)
	frameWrap.append(error)
	applySearch()
}

function createChapters() {
	if (!(documentsContainer instanceof HTMLElement)) return

	let index = 0
	for (const group of documentGroups) {
		for (const documentEntry of group.documents) {
			index += 1
			documentsContainer.append(createChapter(documentEntry, index, group.label))
		}
	}
}

function frameHeight(frame) {
	const documentElement = frame.contentDocument?.documentElement
	const body = frame.contentDocument?.body
	if (documentElement === undefined || documentElement === null || body === undefined || body === null) {
		return 0
	}
	return Math.max(documentElement.scrollHeight, documentElement.offsetHeight, body.scrollHeight, body.offsetHeight)
}

function resizeFrame(frame) {
	const height = frameHeight(frame)
	if (height > 0) frame.style.height = `${height}px`
}

function sourcePathFromHref(href, baseUrl) {
	const target = new URL(href, baseUrl)
	if (target.origin !== window.location.origin) return undefined
	const fileName = target.pathname.split('/').pop()
	if (fileName === undefined || !documents.some(entry => entry.path === fileName)) return undefined
	const fragment = decodeFragment(target.hash.slice(1))
	if (fragment === undefined) return undefined
	return { fragment, path: fileName }
}

function frameLinkClick(path, frame, event) {
	const frameWindow = frame.contentWindow
	if (frameWindow === null || !(event.target instanceof frameWindow.Element)) return
	const anchor = event.target.closest('a[href]')
	if (!(anchor instanceof frameWindow.HTMLAnchorElement)) return
	const href = anchor.getAttribute('href')
	if (href === null) return
	const requestsSeparateContext = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
	if (href.startsWith('#')) {
		if (requestsSeparateContext) return
		const fragment = decodeFragment(href.slice(1))
		if (fragment === undefined) return
		event.preventDefault()
		navigateToDocument(path, fragment)
		return
	}

	const target = sourcePathFromHref(href, sourceUrl(path))
	if (target === undefined) {
		if (anchor.hasAttribute('download') || anchor.target.length > 0) return
		anchor.target = '_blank'
		anchor.rel = 'noopener noreferrer'
		return
	}
	if (requestsSeparateContext) return
	event.preventDefault()
	navigateToDocument(target.path, target.fragment)
}

function scrollToFrameFragment(path, fragment) {
	const frame = frameByPath.get(path)
	const chapter = chapterByPath.get(path)
	if (frame === undefined || chapter === undefined) return false
	if (failedPaths.has(path)) return false
	if (fragment.length === 0) {
		chapter.scrollIntoView({ block: 'start' })
		return true
	}

	const target = frame.contentDocument?.getElementById(fragment)
	const frameWindow = frame.contentWindow
	if (frameWindow === null || !(target instanceof frameWindow.HTMLElement)) return false
	const outerTop = frame.getBoundingClientRect().top + window.scrollY
	const innerTop = target.getBoundingClientRect().top + (frame.contentWindow?.scrollY ?? 0)
	const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
	window.scrollTo({ behavior, top: outerTop + innerTop - 24 })
	return true
}

function navigateToDocument(path, fragment = '', updateHistory = true) {
	const chapter = chapterByPath.get(path)
	if (chapter === undefined) return
	if (chapter.hidden) {
		if (searchInput instanceof HTMLInputElement) searchInput.value = ''
		applySearch()
	}

	const readerHash = `${chapterId(path)}${fragment.length > 0 ? `--${encodeURIComponent(fragment)}` : ''}`
	if (updateHistory) {
		const currentState = typeof window.history.state === 'object' && window.history.state !== null ? window.history.state : {}
		window.history.replaceState({ ...currentState, readerScrollY: window.scrollY }, '', window.location.href)
		window.history.pushState({}, '', `#${readerHash}`)
	}
	pendingFragmentByPath.clear()
	if (!scrollToFrameFragment(path, fragment)) {
		const allDocumentsSettled = indexedPaths.size + failedPaths.size === documents.length
		if (failedPaths.has(path) || allDocumentsSettled) {
			chapter.scrollIntoView({ block: 'start' })
			return
		}
		pendingFragmentByPath.set(path, fragment)
		chapter.scrollIntoView({ block: 'start' })
	}
}

function initializeFrame(path, frame, frameWrap, frameStatus) {
	const frameDocument = frame.contentDocument
	if (frameDocument === null) {
		const documentEntry = documents.find(entry => entry.path === path)
		if (documentEntry !== undefined) showFrameError(documentEntry, frame, frameWrap, frameStatus)
		return
	}

	resizeFrame(frame)
	frameWrap.dataset.loaded = 'true'
	frameWrap.setAttribute('aria-busy', 'false')
	frameStatus.hidden = true
	failedPaths.delete(path)
	indexedPaths.add(path)
	searchableTextByPath.set(path, `${searchableTextByPath.get(path) ?? ''} ${frameDocument.body?.textContent ?? ''}`.toLowerCase())

	frameDocument.addEventListener('click', event => frameLinkClick(path, frame, event))
	if (typeof ResizeObserver !== 'undefined' && frameDocument.body !== null) {
		const observer = new ResizeObserver(() => resizeFrame(frame))
		observer.observe(frameDocument.body)
	}

	applySearch()
}

function applySearch() {
	if (!(searchInput instanceof HTMLInputElement)) return
	const query = searchInput.value.trim().toLowerCase()
	let matches = 0
	let readyMatches = 0
	let unavailableMatches = 0
	const pendingCount = documents.length - indexedPaths.size - failedPaths.size

	for (const documentEntry of documents) {
		const chapter = chapterByPath.get(documentEntry.path)
		if (chapter === undefined) continue
		const matchesQuery = query.length === 0 || searchableTextByPath.get(documentEntry.path)?.includes(query)
		chapter.hidden = !matchesQuery
		if (!matchesQuery) continue

		matches += 1
		if (indexedPaths.has(documentEntry.path)) {
			readyMatches += 1
		} else if (failedPaths.has(documentEntry.path)) {
			unavailableMatches += 1
		}
	}

	if (searchStatus instanceof HTMLElement) {
		let statusText = `All ${documents.length} documents`
		if (query.length === 0) {
			if (pendingCount > 0) {
				statusText = `Indexing ${indexedPaths.size} of ${documents.length} documents…`
			} else if (failedPaths.size > 0) {
				statusText = `${indexedPaths.size} documents ready; ${failedPaths.size} unavailable`
			}
		} else if (pendingCount > 0) {
			statusText = `${matches} ${matches === 1 ? 'match' : 'matches'} so far; indexing ${pendingCount} more`
		} else if (failedPaths.size > 0) {
			if (readyMatches > 0 && unavailableMatches > 0) {
				statusText = `${readyMatches} ${readyMatches === 1 ? 'match' : 'matches'} in ready documents; ${unavailableMatches} in unavailable documents`
			} else if (readyMatches > 0) {
				statusText = `${readyMatches} ${readyMatches === 1 ? 'match' : 'matches'} in ${indexedPaths.size} ready documents; ${failedPaths.size} unavailable`
			} else if (unavailableMatches > 0) {
				statusText = `${unavailableMatches} metadata ${unavailableMatches === 1 ? 'match' : 'matches'} in unavailable documents; no ready-document matches`
			} else {
				statusText = `No matches in ${indexedPaths.size} ready documents; ${failedPaths.size} unavailable`
			}
		} else {
			statusText = `${matches} ${matches === 1 ? 'document' : 'documents'} found`
		}
		searchStatus.textContent = statusText
	}
	if (documentsContainer instanceof HTMLElement) {
		documentsContainer.setAttribute('aria-busy', pendingCount > 0 ? 'true' : 'false')
	}
	if (emptyState instanceof HTMLElement) {
		emptyState.hidden = matches !== 0 || pendingCount > 0 || failedPaths.size > 0
	}
	if (pendingCount === 0) {
		for (const [path, fragment] of pendingFragmentByPath) {
			if (!scrollToFrameFragment(path, fragment)) {
				chapterByPath.get(path)?.scrollIntoView({ block: 'start' })
			}
			pendingFragmentByPath.delete(path)
		}
	}
}

function updateProgress() {
	if (!(progress instanceof HTMLElement)) return
	const scrollable = document.documentElement.scrollHeight - window.innerHeight
	const percentage = scrollable <= 0 ? 0 : Math.min(100, (window.scrollY / scrollable) * 100)
	progress.style.width = `${percentage}%`
}

function observeChapters() {
	const links = Array.from(document.querySelectorAll('[data-document-path]'))
	const observer = new IntersectionObserver(
		entries => {
			const visibleEntry = entries.filter(entry => entry.isIntersecting).sort((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top))[0]
			if (visibleEntry === undefined) return
			const path = visibleEntry.target.getAttribute('data-document-path')
			for (const link of links) {
				const isCurrent = link.getAttribute('data-document-path') === path ? 'location' : undefined
				if (isCurrent === undefined) link.removeAttribute('aria-current')
				else link.setAttribute('aria-current', isCurrent)
			}
		},
		{ rootMargin: '-10% 0px -78% 0px' },
	)

	for (const chapter of chapterByPath.values()) observer.observe(chapter)
}

function restoreHash() {
	const hash = decodeFragment(window.location.hash.slice(1))
	if (hash === undefined || hash.length === 0) return false

	for (const documentEntry of documents) {
		const prefix = chapterId(documentEntry.path)
		if (hash === prefix) {
			navigateToDocument(documentEntry.path, '', false)
			return true
		}
		if (hash.startsWith(`${prefix}--`)) {
			navigateToDocument(documentEntry.path, hash.slice(prefix.length + 2), false)
			return true
		}
	}
	return false
}

createNavigation()
createChapters()
observeChapters()
restoreHash()
applySearch()
updateProgress()

for (const link of document.querySelectorAll('[data-reader-path]')) {
	link.addEventListener('click', event => {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
		const path = link.getAttribute('data-reader-path')
		if (path === null) return
		event.preventDefault()
		navigateToDocument(path)
	})
}
for (const link of navigation?.querySelectorAll('a[data-document-path]') ?? []) {
	link.addEventListener('click', event => {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
		const path = link.getAttribute('data-document-path')
		if (path === null) return
		event.preventDefault()
		navigateToDocument(path)
	})
}
searchInput?.addEventListener('input', applySearch)
clearSearchButton?.addEventListener('click', () => {
	if (!(searchInput instanceof HTMLInputElement)) return
	searchInput.value = ''
	applySearch()
	searchInput.focus()
})
document.addEventListener('keydown', event => {
	if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
	if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
	event.preventDefault()
	searchInput?.focus()
})
window.addEventListener('scroll', updateProgress, { passive: true })
window.addEventListener('popstate', event => {
	if (restoreHash()) return
	pendingFragmentByPath.clear()
	const savedScrollY = event.state?.readerScrollY
	window.scrollTo({ behavior: 'instant', top: typeof savedScrollY === 'number' ? savedScrollY : 0 })
})
window.addEventListener('resize', () => {
	for (const frame of frameByPath.values()) resizeFrame(frame)
	updateProgress()
})
