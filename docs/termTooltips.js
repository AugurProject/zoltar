const termDefinitions = {
	callback: 'A contract call OpenOracle makes during settlement so another contract can consume the settled report amounts.',
	bounty: 'The ETH the coordinator forwards to OpenOracle so a settler has a settlement incentive.',
	'child rep': 'Reputation minted inside a child universe from migration balance.',
	'colored coins model': 'A branch-aware claim model for coordinating assets after a fork.',
	'complete set': 'One Invalid, one Yes, and one No share minted together against ETH collateral.',
	'escalation game': 'The local dispute process that tries to resolve a market before a fork.',
	'escalation halt': 'The maximum report size after which OpenOracle disputes stop multiplying and advance linearly.',
	'eth-notional': 'Operation exposure expressed as ETH value so different operation types can share one budget.',
	'fresh price': 'A cached oracle price that has not passed the coordinator validity window.',
	invalid: 'A valid answer state for an unresolvable or invalid market outcome.',
	'liquidation distance': 'The required margin beyond the liquidation threshold before a staged liquidation may execute.',
	'liquidation threshold': 'The REP/ETH price at which a vault becomes undercollateralized enough to liquidate.',
	malformed: 'An answer encoding rejected by the question definition.',
	'migrated rep': 'REP backing carried into a child universe to support a child pool.',
	migration: 'Moving pool state from a parent universe into child universes after a fork.',
	'migration balance': 'REP value held after a fork that can be split into one or more child universes.',
	'non-decision': 'The unresolved escalation state that opens the Zoltar fork path.',
	pool: 'A SecurityPool for one question in one universe.',
	'price round': 'One settled REP/ETH price plus the operation volume it is allowed to authorize.',
	'price-round budget': 'The remaining ETH-denominated operation volume one settled oracle price may authorize.',
	'report liquidity': 'The economic size of the OpenOracle report that honest reporters can use to dispute a manipulated price.',
	'request bounty': 'The ETH the coordinator forwards to OpenOracle so a settler has a settlement incentive.',
	'soft rejection': 'A callback failure that settles the OpenOracle report but does not update the coordinator price or replay queued operations.',
	'staged operation': 'A queued liquidation, withdrawal, or allowance update waiting for a fresh oracle price.',
	'truth auction': 'A child-pool auction that sells child-universe REP for ETH to repair missing collateral.',
	universe: 'A Zoltar fork domain with its own REP token and optional parent universe.',
	vault: 'A pool-specific REP account whose owner supplies underwriting capacity.',
}

const tooltipId = 'term-tooltip'

function normalizeTermKey(value) {
	return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function ensureTooltipElement() {
	let tooltip = document.getElementById(tooltipId)
	if (tooltip instanceof HTMLDivElement) return tooltip

	tooltip = document.createElement('div')
	tooltip.id = tooltipId
	tooltip.className = 'term-tooltip'
	tooltip.setAttribute('role', 'tooltip')
	tooltip.hidden = true
	tooltip.setAttribute('aria-hidden', 'true')
	document.body.append(tooltip)
	return tooltip
}

function updateTooltipPosition(tooltip, targetRect, pointerX, pointerY) {
	const margin = 12
	const viewportWidth = document.documentElement.clientWidth
	const viewportHeight = document.documentElement.clientHeight

	let left = pointerX ?? targetRect.left + targetRect.width / 2
	let top = pointerY ?? targetRect.top - margin

	const tooltipWidth = tooltip.offsetWidth
	const tooltipHeight = tooltip.offsetHeight

	left = Math.max(margin, Math.min(left - tooltipWidth / 2, viewportWidth - tooltipWidth - margin))

	if (pointerY === undefined) {
		top = targetRect.top - tooltipHeight - margin
	}
	if (top + tooltipHeight > viewportHeight - margin) {
		top = targetRect.top - tooltipHeight - margin
	}
	if (top < margin) {
		top = Math.min(viewportHeight - tooltipHeight - margin, targetRect.bottom + margin)
	}

	tooltip.style.left = `${left}px`
	tooltip.style.top = `${top}px`
}

function applyTermTooltips() {
	const tooltip = ensureTooltipElement()

	let activeElement

	function hideTooltip() {
		if (activeElement instanceof HTMLElement) {
			activeElement.removeAttribute('aria-describedby')
		}
		activeElement = undefined
		tooltip.hidden = true
		tooltip.setAttribute('aria-hidden', 'true')
		tooltip.dataset.visible = 'false'
		tooltip.textContent = ''
	}

	function showTooltip(element, pointerX, pointerY) {
		const definition = element.dataset.termDefinition
		if (definition === undefined) return

		if (activeElement instanceof HTMLElement && activeElement !== element) {
			activeElement.removeAttribute('aria-describedby')
		}
		activeElement = element
		element.setAttribute('aria-describedby', tooltipId)
		tooltip.textContent = definition
		tooltip.hidden = false
		tooltip.setAttribute('aria-hidden', 'false')
		tooltip.dataset.visible = 'true'
		updateTooltipPosition(tooltip, element.getBoundingClientRect(), pointerX, pointerY)
	}

	for (const element of document.querySelectorAll('.term')) {
		if (!(element instanceof HTMLElement)) continue

		const rawKey = element.getAttribute('data-term') ?? element.textContent ?? ''
		const definition = termDefinitions[normalizeTermKey(rawKey)]
		if (definition === undefined) continue

		element.dataset.termDefinition = definition
		element.dataset.hasTooltip = 'true'
		if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '0')

		element.addEventListener('mouseenter', event => {
			showTooltip(element, event.clientX, event.clientY + 18)
		})
		element.addEventListener('mousemove', event => {
			if (activeElement !== element) return
			updateTooltipPosition(tooltip, element.getBoundingClientRect(), event.clientX, event.clientY + 18)
		})
		element.addEventListener('mouseleave', () => {
			if (activeElement !== element) return
			hideTooltip()
		})
		element.addEventListener('focus', () => {
			showTooltip(element)
		})
		element.addEventListener('blur', () => {
			if (activeElement !== element) return
			hideTooltip()
		})
	}

	document.addEventListener(
		'scroll',
		() => {
			if (!(activeElement instanceof HTMLElement)) return
			updateTooltipPosition(tooltip, activeElement.getBoundingClientRect())
		},
		{ passive: true },
	)

	window.addEventListener('resize', () => {
		if (!(activeElement instanceof HTMLElement)) return
		updateTooltipPosition(tooltip, activeElement.getBoundingClientRect())
	})
}

applyTermTooltips()
