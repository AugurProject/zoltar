// Match the accessible name without decorative content that assistive technology ignores.
export const browserButtonNameExpression = `(button.getAttribute('aria-label') ?? (() => { const copy = button.cloneNode(true); copy.querySelectorAll('[aria-hidden="true"]').forEach(hidden => hidden.remove()); return copy.textContent?.trim() })())`

export function createProductionBrowserActions(options: { readonly evaluate: (expression: string) => Promise<unknown>; readonly readBody: () => Promise<string>; readonly timeoutMilliseconds?: number; readonly now?: () => number; readonly wait?: (milliseconds: number) => Promise<unknown> }) {
	const now = options.now ?? Date.now
	const wait = options.wait ?? Bun.sleep
	const clickButton = async (label: string, occurrence = 0) => {
		const deadline = now() + (options.timeoutMilliseconds ?? 30_000)
		while (now() < deadline) {
			// Readiness and the click share one browser task, so a state refresh cannot intervene.
			const clicked = await options.evaluate(
				`(() => { const buttons = [...document.querySelectorAll('button')].filter(button => ${browserButtonNameExpression} === ${JSON.stringify(label)} && !button.disabled); const button = buttons[${occurrence.toString()}]; if (!(button instanceof HTMLButtonElement)) return false; button.focus(); if (!button.isConnected || button.disabled) return false; button.click(); return true })()`,
			)
			if (clicked === true) return
			const remaining = deadline - now()
			if (remaining <= 0) break
			await wait(Math.min(50, remaining))
		}
		throw new Error(`Timed out clicking enabled browser button ${label} at occurrence ${occurrence.toString()}. Last body: ${await options.readBody()}`)
	}
	return { clickButton }
}
