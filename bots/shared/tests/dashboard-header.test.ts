import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { operatorHeader as chaosHeader } from '../../chaos/src/dashboard/header.ts'
import { operatorHeader as liquidatorHeader } from '../../liquidator/src/dashboard/header.ts'
import { operatorHeader as arbitragerHeader } from '../../open-oracle-arbitrager/src/dashboard/header.ts'

for (const [bot, header, ids] of [
	['chaos', chaosHeader, ['global-error', 'operator-alerts']],
	['liquidator', liquidatorHeader, ['global-error', 'operator-alerts']],
	['open-oracle-arbitrager', arbitragerHeader, ['launch-notice', 'notice']],
] as const) {
	test(`${bot} keeps global notices in the header on every tab`, async () => {
		const window = new Window({ url: 'http://localhost/settings' })
		const source = await Bun.file(new URL(`../../${bot}/src/dashboard/index.html`, import.meta.url)).text()
		window.document.write(source.replace('<!-- operator-header -->', header))
		for (const id of ids) {
			const notices = window.document.querySelectorAll(`#${id}`)
			expect(notices.length).toBe(1)
			expect(notices[0]?.closest('header .operator-notices')).not.toBeNull()
			expect(notices[0]?.hasAttribute('data-page-content')).toBe(false)
		}
		await window.happyDOM.close()
	})
}
