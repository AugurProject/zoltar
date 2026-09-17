import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { repMarketConsensusPanel } from '@zoltar/bot-shared/dashboard/rep-market-consensus'
import { rpcConnectivityFields } from '@zoltar/bot-shared/dashboard/rpc-connectivity'
import { operatorHeader } from '../../src/dashboard/header.ts'

async function dashboardFixture() {
	const source = await Bun.file(new URL('../../src/dashboard/index.html', import.meta.url)).text()
	return source
		.replace('<!-- operator-header -->', operatorHeader)
		.replace('<!-- rep-market-consensus -->', repMarketConsensusPanel())
		.replace('<!-- rpc-connectivity-fields -->', rpcConnectivityFields({ submissionLimit: 8, statusId: 'connectivity-status' }))
		.replace('<script type="module" src="/dashboard.js"></script>', '')
}

test('keeps global notices in the header on every tab', async () => {
	const window = new Window({ url: 'http://localhost/settings' })
	try {
		window.document.write(await dashboardFixture())
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
		window.document.write(await dashboardFixture())
		const strategyForm = window.document.getElementById('strategy-form')
		if (strategyForm === null) throw new Error('Missing strategy form in fixture')
		const wrong = window.document.createElement('div')
		wrong.id = 'strategy-form'
		wrong.append(...strategyForm.childNodes)
		strategyForm.replaceWith(wrong)
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
