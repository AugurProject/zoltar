import { element } from './dom.ts'

const NARROW_VIEWPORT = '(max-width: 42rem)'

function sections() {
	return Array.from(document.querySelectorAll('.settings-section')).filter((section): section is HTMLElement => section instanceof HTMLElement)
}

/** A section rendered with `collapsed` (such as Advanced) starts closed everywhere and only expands when it is the target. */
function startsCollapsed(section: HTMLElement) {
	return section.dataset['settingsCollapsed'] === 'true'
}

function chips() {
	return Array.from(element('settings-nav').querySelectorAll('a[data-settings-target]')).filter((chip): chip is HTMLAnchorElement => chip instanceof HTMLAnchorElement)
}

function isNarrow() {
	return typeof window.matchMedia === 'function' && window.matchMedia(NARROW_VIEWPORT).matches
}

function markCurrent(sectionId: string) {
	for (const chip of chips()) {
		if (chip.dataset['settingsTarget'] === sectionId) {
			chip.setAttribute('aria-current', 'true')
			// Keep the current chip visible inside the row when the row itself scrolls horizontally.
			const nav = element('settings-nav')
			if (typeof nav.scrollTo === 'function' && chip.offsetWidth > 0) nav.scrollTo({ left: Math.max(0, chip.offsetLeft - 16) })
		} else chip.removeAttribute('aria-current')
	}
}

function reducedMotion() {
	return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Every non-collapsed group open, which is the wide-viewport layout and the state a widened viewport returns to. */
function expandAll() {
	for (const section of sections()) {
		if (startsCollapsed(section)) continue
		for (const details of section.querySelectorAll('details.settings-group')) if (details instanceof HTMLDetailsElement) details.open = true
	}
}

/** On narrow viewports only one group stays expanded so the page reads as a stepper instead of an eight-thousand-pixel scroll. */
function expandOnly(sectionId: string) {
	for (const section of sections()) {
		const open = section.id === sectionId
		for (const details of section.querySelectorAll('details.settings-group')) {
			if (!(details instanceof HTMLDetailsElement)) continue
			details.open = open
		}
	}
}

/** Height of the chrome pinned to the viewport top: the operator header plus the chip row wherever the row is sticky. */
function stickyChromeHeight() {
	const shell = document.querySelector('.operator-shell')
	const nav = element('settings-nav')
	const shellHeight = shell instanceof HTMLElement ? shell.getBoundingClientRect().height : 0
	const navSticky = typeof getComputedStyle === 'function' && getComputedStyle(nav).position === 'sticky'
	return shellHeight + (navSticky ? nav.getBoundingClientRect().height : 0)
}

/**
 * The group whose heading is the last one at or within the upper third of the reading window, so small layout shifts do
 * not flip it. Undefined while the Settings page is not rendered, since hidden sections all measure at the origin.
 */
function currentSectionId() {
	if (sections().some(section => section.getClientRects().length === 0)) return undefined
	const band = stickyChromeHeight() + Math.max(24, window.innerHeight / 3)
	let current = sections()[0]?.id
	for (const section of sections()) {
		if (section.getBoundingClientRect().top <= band) current = section.id
	}
	return current
}

/**
 * The Settings page is grouped into setup steps; the chip row jumps between them, tracks the group in view, and on
 * narrow viewports collapses every other group so only the current step is expanded.
 */
export function createSettingsNavigation() {
	const nav = element('settings-nav')
	// While a chip-triggered scroll is in flight the target stays highlighted; tracking resumes once the position settles.
	let jumpTarget: string | undefined
	// The chip row sticks directly under the sticky operator header, whose height depends on the viewport.
	const placeUnderHeader = () => {
		const shell = document.querySelector('.operator-shell')
		nav.style.top = `${(shell instanceof HTMLElement ? shell.getBoundingClientRect().height : 0).toString()}px`
		// Anchored jumps must clear the sticky chrome, whose height depends on the viewport.
		const margin = `${(stickyChromeHeight() + 16).toString()}px`
		for (const section of sections()) section.style.scrollMarginTop = margin
		if (jumpTarget === undefined) {
			const sectionId = currentSectionId()
			if (sectionId !== undefined) markCurrent(sectionId)
		}
	}
	placeUnderHeader()
	let narrow = isNarrow()
	window.addEventListener(
		'resize',
		() => {
			// Widening past the breakpoint restores the all-open layout a wide viewport starts with.
			const nowNarrow = isNarrow()
			if (narrow && !nowNarrow) expandAll()
			if (!narrow && nowNarrow) expandOnly(jumpTarget ?? chips().find(chip => chip.hasAttribute('aria-current'))?.dataset['settingsTarget'] ?? sections()[0]?.id ?? '')
			narrow = nowNarrow
			placeUnderHeader()
		},
		{ passive: true },
	)
	// The page switch keeps the Settings markup hidden until selected, so the highlight is recomputed once it renders.
	if (typeof MutationObserver === 'function') new MutationObserver(placeUnderHeader).observe(document.body, { attributeFilter: ['data-page'], attributes: true })
	// The header grows once the first snapshot fills its badges, so the offsets follow its size rather than the load-time guess.
	const shell = document.querySelector('.operator-shell')
	if (typeof ResizeObserver === 'function' && shell instanceof HTMLElement) new ResizeObserver(placeUnderHeader).observe(shell)
	let settleTimer: ReturnType<typeof setTimeout> | undefined
	const settleJump = () => {
		if (jumpTarget === undefined) return
		const target = jumpTarget
		jumpTarget = undefined
		markCurrent(target)
	}
	const scheduleSettle = () => {
		if (settleTimer !== undefined) clearTimeout(settleTimer)
		settleTimer = setTimeout(settleJump, 200)
	}
	nav.addEventListener('click', event => {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
		const chip = event.target instanceof Element ? event.target.closest('a[data-settings-target]') : undefined
		if (!(chip instanceof HTMLAnchorElement)) return
		const sectionId = chip.dataset['settingsTarget']
		if (sectionId === undefined) return
		event.preventDefault()
		placeUnderHeader()
		if (isNarrow()) expandOnly(sectionId)
		markCurrent(sectionId)
		jumpTarget = sectionId
		scheduleSettle()
		const section = document.getElementById(sectionId)
		if (!isNarrow()) for (const details of section?.querySelectorAll('details.settings-group') ?? []) if (details instanceof HTMLDetailsElement) details.open = true
		if (section instanceof HTMLElement && typeof section.scrollIntoView === 'function') section.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
	})
	let frame: number | undefined
	window.addEventListener(
		'scroll',
		() => {
			if (frame !== undefined) return
			frame = window.requestAnimationFrame(() => {
				frame = undefined
				if (jumpTarget !== undefined) {
					scheduleSettle()
					return
				}
				const sectionId = currentSectionId()
				if (sectionId !== undefined) markCurrent(sectionId)
			})
		},
		{ passive: true },
	)
	const first = sections()[0]?.id
	if (first !== undefined) {
		markCurrent(first)
		if (isNarrow()) expandOnly(first)
	}
}
