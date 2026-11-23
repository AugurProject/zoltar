import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, origin, qaViewports, writeScreenshot } from './browser-test.ts'

browserTest('defaults to the enabled network and keeps explicitly selected retained history', async () => {
	for (const viewport of qaViewports) {
		await withBrowserPage(`${origin}/?demo=1&sepoliaOnly=1`, viewport, async session => {
			await session.waitFor(`document.querySelector('#global-network-filter')?.options.length === 2 && document.querySelector('#global-network-filter')?.value === '11155111'`)
			expect(await session.evaluate(`new URL(location.href).searchParams.get('chainId')`)).toBe('11155111')
			expect(await session.evaluate(`document.querySelector('#global-network-filter').value`)).toBe('11155111')
			expect(await session.evaluate(`[...document.querySelectorAll('.product-nav a')].every(link => new URL(link.href).searchParams.get('chainId') === '11155111')`)).toBeTrue()
			await writeScreenshot(session, `/tmp/augurscan-enabled-network-${viewport.width}.png`)
			await session.send('Page.navigate', { url: `${origin}/?demo=1&sepoliaOnly=1&chainId=1` })
			await session.waitFor(`document.querySelector('#global-network-filter')?.options.length === 2 && document.querySelector('#global-network-filter')?.value === '1'`)
			expect(await session.evaluate(`document.querySelector('#global-network-filter').value`)).toBe('1')
			await session.send('Page.navigate', { url: `${origin}/?demo=1&sepoliaOnly=unstarted` })
			await session.waitFor(`document.querySelector('#network-notice')?.textContent.includes('Waiting for an enabled network')`)
			expect(await session.evaluate(`new URL(location.href).searchParams.has('chainId')`)).toBeFalse()
			await session.evaluate(`document.querySelector('#global-network-filter').value = '1'; document.querySelector('#global-network-apply').click()`)
			await session.waitFor(`new URL(location.href).searchParams.get('chainId') === '1' && document.querySelector('#network-notice') === null`)
			expect(session.issues).toEqual([])
		})
	}
})
