/**
 * Page-side crawl helpers for `tooling/ui/layoutScan.mts`.
 *
 * `installLayoutScanHelpers` is injected into every page with `Function.prototype.toString`, so it must stay
 * self-contained. It tracks DOM activity so the scanner can wait for a settled page, lists the app's routes and the
 * tabs, disclosures, and dialog launchers on the current page, and draws the highlight used for finding screenshots.
 */

export type LayoutScanTab = { readonly id: string; readonly label: string }

type LayoutScanHelpers = {
	readonly quietFor: () => number
	readonly busy: () => boolean
	readonly routes: () => string[]
	readonly routeHash: () => string
	readonly tabs: () => LayoutScanTab[]
	readonly clickTab: (id: string) => boolean
	readonly expandDisclosures: () => number
	readonly launchers: () => LayoutScanTab[]
	readonly clickLauncher: (id: string) => boolean
	readonly openPopup: () => string | undefined
	readonly closePopup: () => boolean
	readonly highlight: (primaryId: string, relatedId: string | undefined, label: string) => { x: number; y: number; width: number; height: number } | undefined
	readonly clearHighlight: () => void
	readonly scrollExtent: () => { height: number; viewport: number }
}

declare global {
	interface Window {
		__layoutScan?: LayoutScanHelpers
	}
}

export function installLayoutScanHelpers() {
	let lastMutation = performance.now()
	const observe = () => {
		const observer = new MutationObserver(() => {
			lastMutation = performance.now()
		})
		observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-busy', 'aria-selected', 'aria-expanded', 'open', 'disabled'] })
	}
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe)
	else observe()

	const normalize = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
	const isVisible = (element: Element) => {
		const rect = element.getBoundingClientRect()
		if (rect.width === 0 || rect.height === 0) return false
		const style = getComputedStyle(element)
		return style.visibility !== 'hidden' && style.display !== 'none'
	}
	const isEnabled = (element: Element) => !(element instanceof HTMLButtonElement && element.disabled) && element.getAttribute('aria-disabled') !== 'true' && element.closest('fieldset:disabled') === null
	const popupSelector = '[role=dialog], dialog[open], [aria-modal=true], [role=menu]'
	const routeHash = () => {
		const hash = window.location.hash
		const queryIndex = hash.indexOf('?')
		return queryIndex === -1 ? hash : hash.slice(0, queryIndex)
	}
	const labelOf = (element: Element) => normalize(element.getAttribute('aria-label')) || normalize(element instanceof HTMLElement ? element.innerText : element.textContent)
	const tabId = (tab: Element) => {
		const list = tab.closest('[role=tablist]')
		return `${normalize(list?.getAttribute('aria-label')) || 'tabs'}::${labelOf(tab)}`
	}
	const tabElements = () => [...document.querySelectorAll('[role=tab]')].filter(tab => isVisible(tab) && tab.closest(popupSelector) === null)
	const launcherElements = () => [...document.querySelectorAll('button[aria-haspopup=dialog], button[aria-haspopup=menu], button[aria-haspopup=true], .action-launcher-card-actions button')].filter(button => isVisible(button) && isEnabled(button) && button.closest(popupSelector) === null)
	const launcherId = (button: Element) => `${normalize(button.closest('section, article, [role=tabpanel]')?.querySelector('h1, h2, h3, h4')?.textContent).slice(0, 40)}::${labelOf(button)}`
	const visiblePopup = () => [...document.querySelectorAll(popupSelector)].find(isVisible)

	const helpers: LayoutScanHelpers = {
		quietFor: () => performance.now() - lastMutation,
		busy: () => [...document.querySelectorAll('[aria-busy=true]')].some(isVisible),
		routeHash,
		routes: () => {
			const state: unknown = Reflect.get(globalThis, '__zoltarActiveRoutingState__')
			const hashes = new Set<string>()
			if (typeof state === 'object' && state !== null) {
				const hashByRoute: unknown = Reflect.get(state, 'hashByRoute')
				if (typeof hashByRoute === 'object' && hashByRoute !== null) for (const hash of Object.values(hashByRoute)) if (typeof hash === 'string') hashes.add(hash)
			}
			// Views selected by query parameters and parameterized records, such as a market or pool page, are only reachable
			// through links on the current page. Simulation and network parameters are dropped so a link never switches scenario.
			for (const link of document.querySelectorAll('a[href*="#/"]')) {
				const href = link.getAttribute('href') ?? ''
				const hash = href.slice(href.indexOf('#'))
				const queryIndex = hash.indexOf('?')
				if (queryIndex === -1) {
					hashes.add(hash)
					continue
				}
				const params = new URLSearchParams(hash.slice(queryIndex + 1))
				for (const key of ['genesis', 'network', 'rpcUrl', 'simScenario', 'simState', 'simulate']) params.delete(key)
				params.sort()
				const search = params.toString()
				hashes.add(search === '' ? hash.slice(0, queryIndex) : `${hash.slice(0, queryIndex)}?${search}`)
			}
			return [...hashes]
		},
		tabs: () => tabElements().map(tab => ({ id: tabId(tab), label: labelOf(tab) })),
		clickTab: id => {
			const tab = tabElements().find(candidate => tabId(candidate) === id)
			if (tab === undefined || !(tab instanceof HTMLElement) || !isEnabled(tab)) return false
			if (tab.getAttribute('aria-selected') === 'true') return true
			tab.click()
			return true
		},
		expandDisclosures: () => {
			let expanded = 0
			for (const details of document.querySelectorAll('details:not([open])')) {
				if (details.closest('[hidden]') !== null) continue
				details.setAttribute('open', '')
				expanded++
			}
			for (const button of document.querySelectorAll('button[aria-expanded=false]:not([aria-haspopup]), [role=button][aria-expanded=false]:not([aria-haspopup])')) {
				if (!(button instanceof HTMLElement) || !isVisible(button) || !isEnabled(button) || button.closest(popupSelector) !== null || button.closest('header, nav') !== null) continue
				button.click()
				expanded++
			}
			return expanded
		},
		launchers: () => launcherElements().map(button => ({ id: launcherId(button), label: labelOf(button) })),
		clickLauncher: id => {
			const button = launcherElements().find(candidate => launcherId(candidate) === id)
			if (!(button instanceof HTMLElement)) return false
			button.scrollIntoView({ block: 'center', behavior: 'instant' })
			button.click()
			return true
		},
		openPopup: () => {
			const popup = visiblePopup()
			if (popup === undefined) return undefined
			return normalize(popup.getAttribute('aria-label')) || normalize(popup.querySelector('h1, h2, h3, h4')?.textContent) || popup.tagName.toLowerCase()
		},
		closePopup: () => {
			const popup = visiblePopup()
			if (popup === undefined) return true
			const close = [...popup.querySelectorAll('button')].find(button => /^(close|cancel|dismiss)\b/i.test(normalize(button.getAttribute('aria-label')) || normalize(button.textContent)))
			if (close !== undefined) close.click()
			else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
			return false
		},
		highlight: (primaryId, relatedId, label) => {
			helpers.clearHighlight()
			const primary = document.querySelector(`[data-layout-scan-id="${primaryId}"]`)
			if (primary === null) return undefined
			const related = relatedId === undefined ? null : document.querySelector(`[data-layout-scan-id="${relatedId}"]`)
			primary.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
			const boxes = [primary, ...(related === null ? [] : [related])].map(element => element.getBoundingClientRect())
			const draw = (rect: DOMRect, color: string, caption: string | undefined) => {
				const box = document.createElement('div')
				box.className = 'layout-scan-highlight'
				box.style.cssText = `position:fixed;left:${(rect.left - 2).toString()}px;top:${(rect.top - 2).toString()}px;width:${(rect.width + 4).toString()}px;height:${(rect.height + 4).toString()}px;outline:2px dashed ${color};background:color-mix(in srgb, ${color} 12%, transparent);z-index:2147483647;pointer-events:none;`
				if (caption !== undefined) {
					const tag = document.createElement('span')
					tag.textContent = caption
					tag.style.cssText = `position:absolute;left:0;top:-20px;font:600 11px/16px monospace;background:${color};color:#fff;padding:1px 4px;white-space:nowrap;`
					if (rect.top < 24) tag.style.top = `${(rect.height + 6).toString()}px`
					box.append(tag)
				}
				document.body.append(box)
			}
			const [primaryRect, relatedRect] = boxes
			if (relatedRect !== undefined) draw(relatedRect, '#1d6fd6', undefined)
			if (primaryRect !== undefined) draw(primaryRect, '#d6261d', label)
			// Frame the finding with enough of its surroundings to recognise where it is on the page.
			const viewportWidth = document.documentElement.clientWidth
			const viewportHeight = window.innerHeight
			const minimumWidth = Math.min(viewportWidth, 640)
			const minimumHeight = Math.min(viewportHeight, 280)
			let left = Math.max(0, Math.min(...boxes.map(rect => rect.left)) - 32)
			let top = Math.max(0, Math.min(...boxes.map(rect => rect.top)) - 40)
			let right = Math.min(viewportWidth, Math.max(...boxes.map(rect => rect.right)) + 32)
			let bottom = Math.min(viewportHeight, Math.max(...boxes.map(rect => rect.bottom)) + 32)
			if (right - left < minimumWidth) {
				const grow = (minimumWidth - (right - left)) / 2
				left = Math.max(0, left - grow)
				right = Math.min(viewportWidth, left + minimumWidth)
				left = Math.max(0, right - minimumWidth)
			}
			if (bottom - top < minimumHeight) {
				const grow = (minimumHeight - (bottom - top)) / 2
				top = Math.max(0, top - grow)
				bottom = Math.min(viewportHeight, top + minimumHeight)
				top = Math.max(0, bottom - minimumHeight)
			}
			return { x: left + window.scrollX, y: top + window.scrollY, width: right - left, height: bottom - top }
		},
		clearHighlight: () => {
			for (const box of document.querySelectorAll('.layout-scan-highlight')) box.remove()
		},
		scrollExtent: () => ({ height: document.documentElement.scrollHeight, viewport: window.innerHeight }),
	}
	window.__layoutScan = helpers
}
