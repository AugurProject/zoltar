import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { operatorHeader } from '../../src/dashboard/header.ts'

test('keeps global notices in the header on every tab', async () => {
	const window = new Window({ url: 'http://localhost/settings' })
	try {
		const source = await Bun.file(new URL('../../src/dashboard/index.html', import.meta.url)).text()
		window.document.write(source.replace('<!-- operator-header -->', operatorHeader))
		for (const id of ['global-error', 'operator-alerts']) {
			const notices = window.document.querySelectorAll(`#${id}`)
			expect(notices.length).toBe(1)
			expect(notices[0]?.closest('header .operator-notices')).not.toBeNull()
			expect(notices[0]?.hasAttribute('data-page-content')).toBe(false)
		}
	} finally {
		await window.happyDOM.close()
	}
})
