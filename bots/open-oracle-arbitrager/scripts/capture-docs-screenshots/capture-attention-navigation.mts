import { type BrowserSession, VIEWPORTS } from './browser-session.mts'
import { fixture } from './fixture-state.mts'

/** Following the attention badge must open the Operations page with the recovery or transaction target below the sticky header (`OPEN_ORACLE_CAPTURE_QA=1`). */
export async function captureAttentionNavigation(session: BrowserSession, origin: string) {
	for (const attention of ['recovery', 'transaction'] as const) {
		fixture.attention = attention
		const expectedTarget = attention === 'recovery' ? 'position-lifecycle' : 'transaction-tracking'
		const expectedSection = 'operations'
		for (const { mobile, width, height, suffix } of VIEWPORTS) {
			await session.replacePage(`${origin}/?attention=${attention}-${suffix}`, width, height)
			await Bun.sleep(750)
			await session.run(`document.querySelector('#attention-badge')?.click()`)
			await Bun.sleep(250)
			await session.settlePaint()
			const value = await session.read(`(() => {
				const active = document.querySelector('.section-nav a[aria-current="page"]')
				const activeRect = active?.getBoundingClientRect()
				const header = document.querySelector('.operator-shell')
				const nav = document.querySelector('.section-nav')
				const navRect = nav?.getBoundingClientRect()
				const target = document.getElementById(${JSON.stringify(expectedTarget)})
				return {
					activeHref: active?.getAttribute('href'),
					activeVisible: activeRect !== undefined && navRect !== undefined && activeRect.left >= navRect.left - 1 && activeRect.right <= navRect.right + 1,
					bodyScrollWidth: document.body.scrollWidth,
					hash: window.location.hash,
					headerBottom: header?.getBoundingClientRect().bottom,
					targetTop: target?.getBoundingClientRect().top
				}
			})()`)
			if (
				typeof value !== 'object' ||
				value === null ||
				!('activeHref' in value) ||
				value.activeHref !== `/${expectedSection}` ||
				!('activeVisible' in value) ||
				value.activeVisible !== true ||
				!('hash' in value) ||
				value.hash !== `#${expectedTarget}` ||
				!('headerBottom' in value) ||
				!('targetTop' in value) ||
				typeof value.headerBottom !== 'number' ||
				typeof value.targetTop !== 'number' ||
				value.targetTop < value.headerBottom ||
				(mobile && 'bodyScrollWidth' in value && typeof value.bodyScrollWidth === 'number' && value.bodyScrollWidth > width)
			)
				throw new Error(`${attention} attention navigation failed at ${width.toString()}px`)
			await session.capturePng(`attention-${attention}-${suffix}.png`)
		}
	}
	fixture.attention = 'none'
}
