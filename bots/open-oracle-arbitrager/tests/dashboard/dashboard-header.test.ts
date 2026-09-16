import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { operatorHeader } from '../../src/dashboard/header.ts'

test('keeps global notices in the header on every tab', async () => {
	const window = new Window({ url: 'http://localhost/settings' })
	try {
		const source = await Bun.file(new URL('../../src/dashboard/index.html', import.meta.url)).text()
		window.document.write(source.replace('<!-- operator-header -->', operatorHeader).replace('<script type="module" src="/dashboard.js"></script>', ''))
		for (const id of ['launch-notice', 'notice']) {
			const notices = window.document.querySelectorAll(`#${id}`)
			expect(notices.length).toBe(1)
			expect(notices[0]?.closest('header .operator-notices')).not.toBeNull()
			expect(notices[0]?.hasAttribute('data-page-content')).toBe(false)
		}
	} finally {
		await window.happyDOM.close()
	}
})

test('rejects a dashboard control with the wrong element type', async () => {
	const window = new Window({ url: 'http://localhost/settings', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } })
	try {
		const source = await Bun.file(new URL('../../src/dashboard/index.html', import.meta.url)).text()
		window.document.write(source.replace('<!-- operator-header -->', operatorHeader).replace('<script type="module" src="/dashboard.js"></script>', ''))
		const pause = window.document.getElementById('strategy-form')
		if (pause === null) throw new Error('Missing pause control in fixture')
		const wrong = window.document.createElement('div')
		wrong.id = 'strategy-form'
		wrong.append(...pause.childNodes)
		pause.replaceWith(wrong)
		const build = await Bun.build({ entrypoints: [new URL('../../src/dashboard/dashboard.ts', import.meta.url).pathname], target: 'browser', format: 'iife' })
		if (!build.success || build.outputs[0] === undefined) throw new Error('Dashboard bundle failed')
		const script = await build.outputs[0].text()
		window.fetch = async () => await new Promise(() => {})
		window.setInterval = () => {
			const timeout = window.setTimeout(() => undefined, 1)
			window.clearTimeout(timeout)
			return timeout
		}
		expect(() => window.eval(script)).toThrow('Missing dashboard element: strategy-form')
	} finally {
		await window.happyDOM.close()
	}
})
