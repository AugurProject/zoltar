import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { createDemoEnvironment } from '../browser/demo-api/environment.ts'
import { demoCatalogRoute } from '../browser/demo-api/catalog-route.ts'
import { overrideGlobals } from '../support/global-overrides.ts'

test('default demo catalog filters each entity collection by query and chain', async () => {
	const browser = new Window({ url: 'http://localhost/?demo=1' })
	const restore = overrideGlobals({ location: browser.location })
	try {
		const env = createDemoEnvironment({ pageUrl: new URL(browser.location.href), canonicalRefreshRequired: false, selectedChainId: () => '1' })
		expect(await demoCatalogRoute(env, '/api/v1/state/catalog?chainId=1&q=no-such-question')).toMatchObject({ pools: [], questions: [], universes: [] })
		expect(await demoCatalogRoute(env, '/api/v1/state/catalog?chainId=1&q=8721049384720193847201')).toMatchObject({ questions: [{ chain_id: '1', question_id: '8721049384720193847201' }], pools: [], universes: [] })
	} finally {
		restore()
		await browser.happyDOM.close()
	}
})
