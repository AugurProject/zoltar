/// <reference types="bun-types" />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { DeploymentStepList } from '../components/DeploymentStepList.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { within } from './testUtils/queries.js'

describe('DeploymentStepList', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('offers line breaks only between the camelCase words of a contract identifier', async () => {
		const renderedComponent = await renderIntoDocument(
			<DeploymentStepList
				steps={[
					{ address: '0x0000000000000000000000000000000000000001', key: 'auction', label: 'UniformPriceDualCapBatchAuctionFactory' },
					{ address: '0x0000000000000000000000000000000000000002', key: 'proxy', label: 'Proxy Deployer' },
				]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const [auctionHeading, proxyHeading] = Array.from(document.body.querySelectorAll('.contract-row h3'))
		if (auctionHeading === undefined || proxyHeading === undefined) throw new Error('Expected two contract headings')
		expect(auctionHeading.textContent).toBe('UniformPriceDualCapBatchAuctionFactory')
		expect(auctionHeading.querySelectorAll('wbr')).toHaveLength(6)
		expect(proxyHeading.textContent).toBe('Proxy Deployer')
		expect(proxyHeading.querySelectorAll('wbr')).toHaveLength(0)
		for (const address of ['0x0000000000000000000000000000000000000001', '0x0000000000000000000000000000000000000002']) {
			expect(within(renderedComponent.container).getByRole('button', { name: `Copy address ${address}` })).not.toBeNull()
			expect(renderedComponent.container.querySelector(`a[href="https://sepolia.etherscan.io/address/${address}"]`)).not.toBeNull()
		}
	})
})
