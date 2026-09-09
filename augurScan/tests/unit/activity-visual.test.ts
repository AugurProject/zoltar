import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const appSource = await readFile(new URL('../../browser/app.ts', import.meta.url), 'utf8')
const styles = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8')

const cssRule = (selector: string) => {
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'u').exec(styles)
	if (match?.[1] === undefined) throw new Error(`Missing CSS rule for ${selector}`)
	return match[1]
}

test('activity row fields use full-height compact targets', () => {
	const targetRule = cssRule('.activity-target')
	expect(targetRule).toContain('min-height: var(--control-height)')
	expect(targetRule).toContain('display: flex')
	expect(targetRule).toContain('overflow: hidden')
})

test('filtered empty activity keeps only its specific no-match status', () => {
	expect(appSource).toContain("feedState.textContent = 'No project logs match these filters yet.'")
	expect(appSource).toContain("$('#activity-summary').textContent = visibleCount === 0 ? ''")
	expect(appSource).not.toContain("visibleCount === 0 ? 'No logs shown'")
})

test('activity detail and narrow navigation controls retain full touch targets', () => {
	for (const selector of ['.detail-disclosure summary', '.icon-button']) expect(cssRule(selector)).toContain('var(--control-height)')

	expect(styles).toMatch(/@media \(max-width: 600px\) \{[\s\S]*?\.product-nav \{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);[^}]*overflow-x: visible;/u)
	expect(styles).toMatch(/@media \(max-width: 600px\) \{[\s\S]*?\.product-nav a \{[^}]*min-width: 0;[^}]*padding-inline: 0\.2rem;/u)
})
