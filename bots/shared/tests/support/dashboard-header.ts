import { expect } from 'bun:test'
import { Window } from 'happy-dom'

/** Renders a bot dashboard page with its operator header and asserts each notice appears once, in the header, outside page content. */
export async function expectHeaderNotices(indexUrl: URL, header: string, ids: readonly string[]) {
	const window = new Window({ url: 'http://localhost/settings' })
	try {
		const source = await Bun.file(indexUrl).text()
		window.document.write(source.replace('<!-- operator-header -->', header))
		for (const id of ids) {
			const notices = window.document.querySelectorAll(`#${id}`)
			expect(notices.length).toBe(1)
			expect(notices[0]?.closest('header .operator-notices')).not.toBeNull()
			expect(notices[0]?.hasAttribute('data-page-content')).toBe(false)
		}
	} finally {
		await window.happyDOM.close()
	}
}
