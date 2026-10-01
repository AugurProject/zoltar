import type { BrowserSession } from './browser-session.mts'

type SectionCapture = readonly [name: string, section: string | undefined]

const MOBILE_SECTION_CAPTURES = new Set(['dashboard-network-mobile.png', 'dashboard-markets-mobile.png', 'dashboard-opportunities-mobile.png', 'deployment-mobile.png', 'configuration-mobile.png', 'settings-mobile.png'])

/** Every captured section lives on Settings except the operations table and the market panel. */
function sectionPage(section: string | undefined) {
	if (section === undefined) return 'overview'
	if (section === 'operations') return 'operations'
	return section === 'token-market-title' ? 'markets' : 'settings'
}

/** The documentation screenshots always captured, plus the optional groups each `OPEN_ORACLE_CAPTURE_*` variable enables. */
function sectionCaptures(): readonly SectionCapture[] {
	return [
		['dashboard-overview.png', undefined],
		['dashboard-network.png', 'network-connectivity'],
		['dashboard-markets.png', 'token-market-title'],
		...(process.env['OPEN_ORACLE_CAPTURE_QA'] === '1'
			? ([
					['dashboard-network-mobile.png', 'network-connectivity'],
					['dashboard-markets-mobile.png', 'token-market-title'],
					['dashboard-opportunities.png', 'operations'],
					['dashboard-opportunities-mobile.png', 'operations'],
				] as const)
			: []),
		...(process.env['OPEN_ORACLE_CAPTURE_DEPLOYMENT'] === '1'
			? ([
					['deployment-desktop.png', 'deployment-configuration'],
					['deployment-mobile.png', 'deployment-configuration'],
					['deployment-create2.png', 'create2-form'],
				] as const)
			: []),
		...(process.env['OPEN_ORACLE_CAPTURE_CONFIGURATION'] === '1'
			? ([
					['configuration-desktop.png', 'complete-configuration'],
					['configuration-mobile.png', 'complete-configuration'],
				] as const)
			: []),
		...(process.env['OPEN_ORACLE_CAPTURE_SETTINGS'] === '1'
			? ([
					['settings-desktop.png', 'network-connectivity'],
					['settings-mobile.png', 'network-connectivity'],
				] as const)
			: []),
	]
}

/** Opens each section's page, scrolls the section below the sticky header, checks the navigation and safety layout, and captures it. */
export async function captureSections(session: BrowserSession, origin: string) {
	for (const [name, section] of sectionCaptures()) {
		const mobile = MOBILE_SECTION_CAPTURES.has(name)
		const fragment = sectionPage(section)
		await session.replacePage(`${origin}/${fragment}`, mobile ? 390 : 1440, mobile ? 844 : 900)
		await Bun.sleep(750)
		if (section !== undefined) {
			await session.run(`(() => {
				const section = document.getElementById(${JSON.stringify(section)})
				if (section === null) return
				if (section instanceof HTMLDetailsElement) section.open = true
				section.closest('details')?.setAttribute('open', '')
				for (const scroller of document.querySelectorAll('.table-scroll')) scroller.scrollLeft = 0
				const offset = (document.querySelector('.operator-shell')?.getBoundingClientRect().height ?? 0) + 16
				window.scrollTo(0, Math.max(0, section.getBoundingClientRect().top + window.scrollY - offset))
			})()`)
			await Bun.sleep(250)
		}
		await session.settlePaint()
		const result = await session.read(`(() => {
			const target = ${section === undefined ? 'undefined' : `document.getElementById(${JSON.stringify(section)})`}
			const active = document.querySelector('.section-nav a[aria-current="page"]')
			const navigation = document.querySelector('.section-nav')
			const activeRect = active?.getBoundingClientRect()
			const navigationRect = navigation?.getBoundingClientRect()
			const safetyTargets = ['mode-badge', 'run-status-badge', 'header-network-badge', 'attention-badge', 'pause-button'].map(id => document.getElementById(id))
			return {
				activeHref: active?.getAttribute('href'),
				activeVisible: activeRect !== undefined && navigationRect !== undefined && activeRect.left >= navigationRect.left - 1 && activeRect.right <= navigationRect.right + 1,
				bodyScrollWidth: document.body.scrollWidth,
				clientWidth: document.documentElement.clientWidth,
				headerBottom: document.querySelector('.operator-shell')?.getBoundingClientRect().bottom,
				safetyVisible: safetyTargets.every(target => {
					if (!(target instanceof HTMLElement)) return false
					const rect = target.getBoundingClientRect()
					return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
				}),
				scrollX: window.scrollX,
				targetTop: target?.getBoundingClientRect().top
			}
		})()`)
		if (mobile && typeof result === 'object' && result !== null && 'bodyScrollWidth' in result && typeof result.bodyScrollWidth === 'number' && result.bodyScrollWidth > 390) {
			throw new Error(`${name} overflows its 390px viewport at ${result.bodyScrollWidth.toString()}px`)
		}
		if (mobile && (typeof result !== 'object' || result === null || !('safetyVisible' in result) || result.safetyVisible !== true)) throw new Error(`${name} clips a sticky safety control`)
		if (mobile && section !== undefined && typeof result === 'object' && result !== null && 'targetTop' in result && 'headerBottom' in result && typeof result.targetTop === 'number' && typeof result.headerBottom === 'number' && result.targetTop < result.headerBottom) {
			throw new Error(`${name} places its target behind the sticky header`)
		}
		if (typeof result !== 'object' || result === null || !('activeHref' in result) || result.activeHref !== `/${fragment}` || !('activeVisible' in result) || result.activeVisible !== true) throw new Error(`${name} does not show its active ${fragment} navigation item`)
		await session.capturePng(name)
	}
}
