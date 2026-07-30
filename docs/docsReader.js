const documentGroups = [
	{
		label: 'Whitepapers',
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
		],
	},
	{
		label: 'Protocol design',
		documents: [
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
const documentByPath = new Map(documents.map(documentEntry => [documentEntry.path, documentEntry]))
const documentsContainer = document.querySelector('[data-reader-documents]')
const navigation = document.querySelector('[data-reader-navigation]')
const progress = document.querySelector('[data-reading-progress]')
const readerShell = document.querySelector('.reader-shell')
const sidebarToggle = document.querySelector('[data-sidebar-toggle]')
const sidebarToggleLabel = document.querySelector('[data-sidebar-toggle-label]')
const chapterByPath = new Map()
const frameWrapByPath = new Map()
const frameStatusByPath = new Map()
const navigationDocumentByPath = new Map()
const pendingFragmentByPath = new Map()
const fragmentStabilizationTimeoutByPath = new Map()
const resizeObserverByPath = new Map()
const requestVersionByPath = new Map()
const readerScrollByUrl = new Map()
const loadedPaths = new Set()
const loadingPaths = new Set()
const failedPaths = new Set()
let activePath
let navigationVersion = 0
let pendingReaderScroll
let readerScrollStabilizationTimeout
const readerFrame = createDocumentFrame()

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

function outlineSections(path) {
	const outline = window.docsReaderOutline
	if (typeof outline !== 'object' || outline === null || !Array.isArray(outline[path])) return []
	return outline[path]
}

function sectionLink(path, section) {
	const item = document.createElement('li')
	const link = document.createElement('a')
	link.href = `#${chapterId(path)}--${encodeURIComponent(section.id)}`
	link.dataset.documentPath = path
	link.dataset.documentFragment = section.id
	if (section.kind === 'tool') {
		link.className = 'reader-nav-tool-link'
		const label = document.createElement('span')
		label.textContent = 'Tool'
		link.append(label, document.createTextNode(section.title))
	} else {
		link.textContent = section.title
	}
	item.append(link)
	return item
}

function createNavigation() {
	if (!(navigation instanceof HTMLElement)) return

	for (const [groupIndex, group] of documentGroups.entries()) {
		const groupElement = document.createElement('details')
		groupElement.className = 'reader-nav-group'
		groupElement.open = groupIndex === 0

		const summary = document.createElement('summary')
		summary.textContent = group.label
		groupElement.append(summary)

		const groupDocuments = document.createElement('div')
		groupDocuments.className = 'reader-nav-documents'

		for (const documentEntry of group.documents) {
			const documentElement = document.createElement('section')
			documentElement.className = 'reader-nav-document'
			documentElement.dataset.navigationDocumentPath = documentEntry.path

			const link = document.createElement('a')
			link.className = 'reader-nav-document-link'
			link.href = `#${chapterId(documentEntry.path)}`
			link.dataset.documentPath = documentEntry.path

			const title = document.createElement('strong')
			title.textContent = documentEntry.title
			link.append(title)

			const sectionList = document.createElement('ul')
			sectionList.className = 'reader-nav-sections'
			sectionList.setAttribute('aria-label', `${documentEntry.title} sections and tools`)
			for (const section of outlineSections(documentEntry.path)) {
				sectionList.append(sectionLink(documentEntry.path, section))
			}
			documentElement.append(link, sectionList)
			groupDocuments.append(documentElement)
			navigationDocumentByPath.set(documentEntry.path, documentElement)
		}

		groupElement.append(groupDocuments)
		navigation.append(groupElement)
	}
}

function markdownFrameSource(path, title) {
	const markdownDocuments = window.docsReaderMarkdown
	if (typeof markdownDocuments !== 'object' || markdownDocuments === null) return ''
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
			<body class="doc-openoracle markdown-reference reader-embedded">
				<main><article>${content}</article></main>
			</body>
	</html>`
}

function htmlFrameSource(path, source) {
	const base = `<base href="${sourceUrl(path)}">`
	const head = /<head(?:\s[^>]*)?>/i.exec(source)
	if (head === null || head.index === undefined) {
		return `${base}${source}`
	}
	const insertionIndex = head.index + head[0].length
	return `${source.slice(0, insertionIndex)}${base}${source.slice(insertionIndex)}`
}

function writeFrameSource(path, frame, source) {
	const frameDocument = frame.contentDocument
	if (frameDocument === null) return false
	frame.dataset.readerSourceReady = 'true'
	frame.dataset.readerSourceUrl = path
	frameDocument.open()
	frameDocument.write(source)
	frameDocument.close()
	initializeFrame(path)
	return true
}

function createDocumentFrame() {
	const frame = document.createElement('iframe')
	frame.className = 'reader-document-frame'
	frame.title = 'Documentation chapter'
	frame.loading = 'lazy'
	frame.addEventListener('load', () => {
		const path = frame.dataset.documentFrame
		if (path === undefined || frame.dataset.readerSourceReady !== 'true') return
		initializeFrame(path)
	})
	frame.addEventListener('error', () => {
		const path = frame.dataset.documentFrame
		const documentEntry = path === undefined ? undefined : documentByPath.get(path)
		if (documentEntry !== undefined && activePath === path && frame.dataset.readerSourceReady === 'true') {
			showFrameError(documentEntry)
		}
	})
	return frame
}

function frameForPath(path) {
	return readerFrame.dataset.documentFrame === path ? readerFrame : undefined
}

function attachReaderFrame(path) {
	const documentEntry = documentByPath.get(path)
	const frameWrap = frameWrapByPath.get(path)
	if (documentEntry === undefined || frameWrap === undefined) return false
	readerFrame.dataset.documentFrame = path
	readerFrame.title = `${documentEntry.title} document`
	frameWrap.append(readerFrame)
	return true
}

function createChapter(documentEntry, index, groupLabel) {
	const chapter = document.createElement('section')
	chapter.className = 'reader-chapter'
	chapter.id = chapterId(documentEntry.path)
	chapter.dataset.documentPath = documentEntry.path
	chapter.hidden = true

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

	header.append(number, heading)

	const frameWrap = document.createElement('div')
	frameWrap.className = 'reader-frame-wrap'
	const frameStatus = document.createElement('span')
	frameStatus.className = 'reader-frame-status'
	frameStatus.setAttribute('role', 'status')
	frameStatus.textContent = 'Loading document…'

	frameWrap.append(frameStatus)
	chapter.append(header, frameWrap)
	chapterByPath.set(documentEntry.path, chapter)
	frameWrapByPath.set(documentEntry.path, frameWrap)
	frameStatusByPath.set(documentEntry.path, frameStatus)
	return chapter
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

function unloadDocumentFrame(path) {
	const frame = frameForPath(path)
	const frameWrap = frameWrapByPath.get(path)
	const frameStatus = frameStatusByPath.get(path)
	if (frame === undefined || frameWrap === undefined || frameStatus === undefined) return

	requestVersionByPath.set(path, (requestVersionByPath.get(path) ?? 0) + 1)
	resizeObserverByPath.get(path)?.disconnect()
	resizeObserverByPath.delete(path)
	loadingPaths.delete(path)
	loadedPaths.delete(path)
	failedPaths.delete(path)
	delete frame.dataset.readerSourceReady
	delete frame.dataset.readerSourceUrl
	delete frame.dataset.readerInitialized
	frame.style.removeProperty('height')
	const frameDocument = frame.contentDocument
	if (frameDocument !== null) {
		frameDocument.open()
		frameDocument.write('<!doctype html><title></title>')
		frameDocument.close()
	}
	frame.removeAttribute('src')
	frame.removeAttribute('srcdoc')
	delete frameWrap.dataset.loaded
	frameWrap.setAttribute('aria-busy', 'false')
	frameStatus.hidden = true
	frameWrap.querySelector('.reader-frame-error')?.remove()
}

async function requestDocumentFrame(path) {
	if (path !== activePath || loadedPaths.has(path) || loadingPaths.has(path)) return
	const documentEntry = documentByPath.get(path)
	const frame = frameForPath(path)
	const frameWrap = frameWrapByPath.get(path)
	const frameStatus = frameStatusByPath.get(path)
	if (documentEntry === undefined || frame === undefined || frameWrap === undefined || frameStatus === undefined) return

	const requestVersion = (requestVersionByPath.get(path) ?? 0) + 1
	requestVersionByPath.set(path, requestVersion)
	const requestIsCurrent = () => activePath === path && requestVersionByPath.get(path) === requestVersion
	loadingPaths.add(path)
	delete frameWrap.dataset.loaded
	frameWrap.setAttribute('aria-busy', 'true')
	frameStatus.hidden = false
	frameStatus.textContent = 'Loading document…'
	frame.hidden = false
	frameWrap.querySelector('.reader-frame-error')?.remove()
	failedPaths.delete(path)
	updateReaderBusyState()

	if (path.endsWith('.md')) {
		const source = markdownFrameSource(path, documentEntry.title)
		if (source.length === 0) {
			showFrameError(documentEntry)
			return
		}
		if (!writeFrameSource(path, frame, source)) {
			showFrameError(documentEntry)
		}
		return
	}

	let response
	try {
		response = await fetch(`./${path}`)
	} catch (error) {
		if (!requestIsCurrent()) return
		if (!(error instanceof TypeError)) throw error
		showFrameError(documentEntry)
		return
	}
	if (!requestIsCurrent()) return
	if (!response.ok) {
		showFrameError(documentEntry)
		return
	}
	let source
	try {
		source = await response.text()
	} catch (error) {
		if (!requestIsCurrent()) return
		if (!(error instanceof TypeError)) throw error
		showFrameError(documentEntry)
		return
	}
	if (!requestIsCurrent()) return
	if (!writeFrameSource(path, frame, htmlFrameSource(path, source))) {
		showFrameError(documentEntry)
	}
}

function showFrameError(documentEntry) {
	if (activePath !== documentEntry.path) return
	const frame = frameForPath(documentEntry.path)
	const frameWrap = frameWrapByPath.get(documentEntry.path)
	const frameStatus = frameStatusByPath.get(documentEntry.path)
	if (frame === undefined || frameWrap === undefined || frameStatus === undefined) return

	delete frame.dataset.readerSourceReady
	delete frame.dataset.readerSourceUrl
	loadingPaths.delete(documentEntry.path)
	loadedPaths.delete(documentEntry.path)
	failedPaths.add(documentEntry.path)
	frameWrap.dataset.loaded = 'true'
	frameWrap.setAttribute('aria-busy', 'false')
	frameStatus.hidden = true
	frame.hidden = true
	frameWrap.querySelector('.reader-frame-error')?.remove()

	const error = document.createElement('div')
	error.className = 'reader-frame-error'
	error.setAttribute('role', 'alert')
	const title = document.createElement('strong')
	title.textContent = `${documentEntry.title} could not be loaded`
	const guidance = document.createElement('p')
	guidance.textContent = 'Check your connection and try this document again.'
	const retry = document.createElement('button')
	retry.type = 'button'
	retry.textContent = 'Retry document'
	retry.addEventListener('click', () => requestDocumentFrame(documentEntry.path))
	error.append(title, guidance, retry)
	frameWrap.append(error)
	updateReaderBusyState()
}

function frameHeight(frame) {
	const documentElement = frame.contentDocument?.documentElement
	const body = frame.contentDocument?.body
	if (documentElement === undefined || documentElement === null || body === undefined || body === null) return 0
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
	if (fileName === undefined || !documentByPath.has(fileName)) return undefined
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
		void navigateToDocument(path, fragment)
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
	void navigateToDocument(target.path, target.fragment)
}

function openFragmentDetails(target, frameWindow) {
	if (target instanceof frameWindow.HTMLDetailsElement) target.open = true
	const containingDetails = target.closest('details')
	if (containingDetails instanceof frameWindow.HTMLDetailsElement) containingDetails.open = true
}

function positionFrameFragment(path, fragment, behavior = 'instant') {
	const frame = frameForPath(path)
	if (frame === undefined) return
	if (fragment.length === 0) {
		chapterByPath.get(path)?.scrollIntoView({ behavior, block: 'start' })
		return
	}
	const target = frame.contentDocument?.getElementById(fragment)
	const frameWindow = frame.contentWindow
	if (frameWindow === null || !(target instanceof frameWindow.HTMLElement)) return
	openFragmentDetails(target, frameWindow)
	resizeFrame(frame)
	const outerTop = frame.getBoundingClientRect().top + window.scrollY
	const innerTop = target.getBoundingClientRect().top + frameWindow.scrollY
	const navigationOffset = window.innerWidth <= 980 ? 72 : 24
	window.scrollTo({ behavior, top: outerTop + innerTop - navigationOffset })
}

function scrollToFrameFragment(path, fragment) {
	const frame = frameForPath(path)
	if (frame === undefined || failedPaths.has(path) || !loadedPaths.has(path)) return false
	if (fragment.length > 0) {
		const target = frame.contentDocument?.getElementById(fragment)
		const frameWindow = frame.contentWindow
		if (frameWindow === null || !(target instanceof frameWindow.HTMLElement)) return false
		openFragmentDetails(target, frameWindow)
	}

	const preferredBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
	positionFrameFragment(path, fragment, preferredBehavior)
	requestAnimationFrame(() => {
		requestAnimationFrame(() => positionFrameFragment(path, fragment))
	})
	window.setTimeout(() => positionFrameFragment(path, fragment), 180)
	return true
}

function stabilizeFrameFragment(path) {
	const fragment = pendingFragmentByPath.get(path)
	if (fragment === undefined || !scrollToFrameFragment(path, fragment)) return
	const existingTimeout = fragmentStabilizationTimeoutByPath.get(path)
	if (existingTimeout !== undefined) window.clearTimeout(existingTimeout)
	const timeout = window.setTimeout(() => {
		positionFrameFragment(path, fragment)
		pendingFragmentByPath.delete(path)
		fragmentStabilizationTimeoutByPath.delete(path)
	}, 650)
	fragmentStabilizationTimeoutByPath.set(path, timeout)
}

function clearPendingReaderScroll() {
	pendingReaderScroll = undefined
	if (readerScrollStabilizationTimeout !== undefined) {
		window.clearTimeout(readerScrollStabilizationTimeout)
		readerScrollStabilizationTimeout = undefined
	}
}

function positionPendingReaderScroll(path) {
	const restoration = pendingReaderScroll
	if (restoration === undefined || restoration.path !== path || restoration.navigationVersion !== navigationVersion || restoration.url !== window.location.href || activePath !== path) {
		return false
	}
	window.scrollTo({ behavior: 'instant', top: restoration.scrollY })
	return true
}

function stabilizePendingReaderScroll(path) {
	const restoration = pendingReaderScroll
	if (restoration === undefined || !positionPendingReaderScroll(path)) return
	requestAnimationFrame(() => {
		requestAnimationFrame(() => positionPendingReaderScroll(path))
	})
	if (readerScrollStabilizationTimeout !== undefined) {
		window.clearTimeout(readerScrollStabilizationTimeout)
	}
	readerScrollStabilizationTimeout = window.setTimeout(() => {
		if (pendingReaderScroll !== restoration) return
		positionPendingReaderScroll(path)
		pendingReaderScroll = undefined
		readerScrollStabilizationTimeout = undefined
	}, 650)
}

function stabilizeReaderPosition(path) {
	stabilizeFrameFragment(path)
	stabilizePendingReaderScroll(path)
}

function setCurrentNavigation(path) {
	for (const link of document.querySelectorAll('.reader-nav-document-link')) {
		if (!(link instanceof HTMLAnchorElement)) continue
		if (link.dataset.documentPath === path) {
			link.setAttribute('aria-current', 'location')
			const group = link.closest('.reader-nav-group')
			if (group instanceof HTMLDetailsElement) group.open = true
		} else {
			link.removeAttribute('aria-current')
		}
	}
}

async function selectDocument(path, fragment = '', positionFragment = true) {
	if (!documentByPath.has(path)) return
	if (positionFragment) clearPendingReaderScroll()
	const previousPath = activePath
	if (previousPath !== undefined && previousPath !== path) {
		unloadDocumentFrame(previousPath)
	}
	activePath = path
	if (!attachReaderFrame(path)) return
	for (const [chapterPath, chapter] of chapterByPath) {
		chapter.hidden = chapterPath !== path
	}
	setCurrentNavigation(path)
	pendingFragmentByPath.clear()
	for (const timeout of fragmentStabilizationTimeoutByPath.values()) window.clearTimeout(timeout)
	fragmentStabilizationTimeoutByPath.clear()
	if (positionFragment && !scrollToFrameFragment(path, fragment)) {
		pendingFragmentByPath.set(path, fragment)
		chapterByPath.get(path)?.scrollIntoView({ block: 'start' })
	}
	await requestDocumentFrame(path)
	updateReaderBusyState()
}

async function navigateToDocument(path, fragment = '', updateHistory = true) {
	const chapter = chapterByPath.get(path)
	if (chapter === undefined) return
	const currentUrl = window.location.href
	const currentScrollY = window.scrollY
	const currentNavigationVersion = navigationVersion + 1
	navigationVersion = currentNavigationVersion
	const readerHash = `${chapterId(path)}${fragment.length > 0 ? `--${encodeURIComponent(fragment)}` : ''}`
	await selectDocument(path, fragment)
	if (updateHistory && navigationVersion === currentNavigationVersion && activePath === path) {
		readerScrollByUrl.set(currentUrl, currentScrollY)
		window.history.pushState({}, '', `#${readerHash}`)
	}
	if (window.matchMedia('(max-width: 980px)').matches) {
		const sidebarPanel = document.querySelector('[data-sidebar-panel]')
		const shouldMoveFocus = sidebarPanel instanceof HTMLElement && sidebarPanel.contains(document.activeElement)
		setSidebarCollapsed(true)
		if (shouldMoveFocus) document.querySelector('#reader-content')?.focus()
	}
}

function initializeFrame(path) {
	const frame = frameForPath(path)
	const frameWrap = frameWrapByPath.get(path)
	const frameStatus = frameStatusByPath.get(path)
	if (frame === undefined || frameWrap === undefined || frameStatus === undefined) return
	const frameDocument = frame.contentDocument
	const frameWindow = frame.contentWindow
	if (frameDocument === null || frameWindow === null) {
		const documentEntry = documentByPath.get(path)
		if (documentEntry !== undefined) showFrameError(documentEntry)
		return
	}

	loadingPaths.delete(path)
	loadedPaths.add(path)
	failedPaths.delete(path)
	frameDocument.body?.classList.add('reader-embedded')
	frameWrap.dataset.loaded = 'true'
	frameWrap.setAttribute('aria-busy', 'false')
	frameStatus.hidden = true
	resizeFrame(frame)

	if (frame.dataset.readerInitialized !== 'true') {
		frame.dataset.readerInitialized = 'true'
		frameDocument.addEventListener('click', event => frameLinkClick(path, frame, event))
		frameDocument.addEventListener(
			'toggle',
			() => {
				resizeFrame(frame)
				stabilizeReaderPosition(path)
			},
			true,
		)
		frameWindow.addEventListener('docs:charts-rendered', () => {
			resizeFrame(frame)
			stabilizeReaderPosition(path)
		})
		frameWindow.addEventListener('docs:tools-ready', () => {
			resizeFrame(frame)
			stabilizeReaderPosition(path)
		})
		if (typeof ResizeObserver !== 'undefined' && frameDocument.body !== null) {
			const observer = new ResizeObserver(() => {
				resizeFrame(frame)
				stabilizeReaderPosition(path)
			})
			observer.observe(frameDocument.body)
			resizeObserverByPath.set(path, observer)
		}
	}

	requestAnimationFrame(() => resizeFrame(frame))
	window.setTimeout(() => resizeFrame(frame), 180)
	stabilizeReaderPosition(path)
	updateReaderBusyState()
}

function updateReaderBusyState() {
	if (!(documentsContainer instanceof HTMLElement)) return
	documentsContainer.setAttribute('aria-busy', activePath !== undefined && loadingPaths.has(activePath) ? 'true' : 'false')
}

function updateProgress() {
	if (!(progress instanceof HTMLElement)) return
	const scrollable = document.documentElement.scrollHeight - window.innerHeight
	const percentage = scrollable <= 0 ? 0 : Math.min(100, (window.scrollY / scrollable) * 100)
	progress.style.width = `${percentage}%`
}

function restoreHash(positionFragment = true) {
	const hash = decodeFragment(window.location.hash.slice(1))
	if (hash === undefined || hash.length === 0) return undefined

	for (const documentEntry of documents) {
		const prefix = chapterId(documentEntry.path)
		if (hash === prefix) {
			void selectDocument(documentEntry.path, '', positionFragment)
			return documentEntry.path
		}
		if (hash.startsWith(`${prefix}--`)) {
			void selectDocument(documentEntry.path, hash.slice(prefix.length + 2), positionFragment)
			return documentEntry.path
		}
	}
	return undefined
}

function setSidebarCollapsed(collapsed) {
	if (!(readerShell instanceof HTMLElement) || !(sidebarToggle instanceof HTMLButtonElement)) return
	readerShell.dataset.sidebarCollapsed = String(collapsed)
	sidebarToggle.setAttribute('aria-expanded', String(!collapsed))
	sidebarToggle.setAttribute('aria-label', collapsed ? 'Expand menu' : 'Collapse menu')
	sidebarToggle.title = collapsed ? 'Expand menu' : ''
	if (sidebarToggleLabel instanceof HTMLElement) {
		sidebarToggleLabel.textContent = collapsed ? 'Expand menu' : 'Collapse menu'
	}
}

function handleReaderNavigationClick(event) {
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
	if (!(event.target instanceof Element)) return
	const link = event.target.closest('a[data-document-path]')
	if (!(link instanceof HTMLAnchorElement)) return
	const path = link.dataset.documentPath
	if (path === undefined) return
	event.preventDefault()
	void navigateToDocument(path, link.dataset.documentFragment ?? '')
}

createNavigation()
createChapters()
setSidebarCollapsed(window.matchMedia('(max-width: 980px)').matches)
if (restoreHash() === undefined) void selectDocument(documents[0].path, '', false)
updateProgress()

navigation?.addEventListener('click', handleReaderNavigationClick)
sidebarToggle?.addEventListener('click', () => {
	const collapsed = readerShell instanceof HTMLElement && readerShell.dataset.sidebarCollapsed === 'true'
	setSidebarCollapsed(!collapsed)
})
window.addEventListener('scroll', updateProgress, { passive: true })
window.addEventListener('popstate', event => {
	navigationVersion += 1
	clearPendingReaderScroll()
	const savedScrollY = readerScrollByUrl.get(window.location.href) ?? event.state?.readerScrollY
	const hasSavedScroll = typeof savedScrollY === 'number'
	let restoredPath = restoreHash(!hasSavedScroll)
	if (restoredPath === undefined) {
		pendingFragmentByPath.clear()
		if (window.location.hash.length === 0) {
			restoredPath = documents[0].path
			void selectDocument(restoredPath, '', false)
		}
	}
	if (hasSavedScroll && restoredPath !== undefined) {
		pendingReaderScroll = {
			navigationVersion,
			path: restoredPath,
			scrollY: savedScrollY,
			url: window.location.href,
		}
		stabilizePendingReaderScroll(restoredPath)
	} else if (restoredPath === undefined) {
		window.scrollTo({ behavior: 'instant', top: 0 })
	}
})
window.addEventListener('resize', () => {
	if (activePath !== undefined) {
		const frame = frameForPath(activePath)
		if (frame !== undefined) resizeFrame(frame)
	}
	updateProgress()
})
