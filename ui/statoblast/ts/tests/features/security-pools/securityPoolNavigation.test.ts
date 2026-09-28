/// <reference types='bun-types' />

import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { getSecurityPoolLinkHref } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolNavigation.js'
import { describe, expect, test } from 'bun:test'

installStatoblastRouting()
describe('securityPoolNavigation', () => {
	installDomTestLifecycle({
		url: 'http://localhost/#/pools/0x0000000000000000000000000000000000000100/vaults?universe=11&simulate=1&simScenario=securitypoolx2',
	})

	test('links to the pool page path with the requested tab and universe', () => {
		const securityPoolAddress = getAddress('0x0000000000000000000000000000000000000200')
		const href = getSecurityPoolLinkHref(securityPoolAddress, 'fork-workflow', 12n)
		const hrefUrl = new URL(href, 'http://localhost')
		const [path = '', search = ''] = hrefUrl.hash.split('?')
		const hrefSearchParams = new URLSearchParams(search)

		expect(path).toBe(`#/pools/${securityPoolAddress}/fork-workflow`)
		expect(hrefSearchParams.get('universe')).toBe('12')
		expect(hrefSearchParams.get('simulate')).toBe('1')
		expect(hrefSearchParams.get('simScenario')).toBe('securitypoolx2')
		expect(hrefSearchParams.has('securityPool')).toBe(false)
	})

	test('keeps the current pool tab when the caller does not provide one, and omits it when asked', () => {
		const securityPoolAddress = getAddress('0x0000000000000000000000000000000000000201')
		expect(getSecurityPoolLinkHref(securityPoolAddress).split('?')[0]).toBe(`#/pools/${securityPoolAddress}/vaults`)
		expect(getSecurityPoolLinkHref(securityPoolAddress).split('?')[1]).toContain('universe=11')
		expect(getSecurityPoolLinkHref(securityPoolAddress, '').split('?')[0]).toBe(`#/pools/${securityPoolAddress}`)
	})
})
