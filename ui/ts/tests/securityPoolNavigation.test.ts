/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/shared/ethereum'
import { getSecurityPoolLinkHref } from '../lib/securityPoolNavigation.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'

describe('securityPoolNavigation', () => {
	let restoreDomEnvironment: (() => void) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment('http://localhost/#/security-pools?selectedPoolView=vaults&universe=11')
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(() => {
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('builds an operate-route href for a selected security pool', () => {
		const securityPoolAddress = getAddress('0x0000000000000000000000000000000000000200')
		const href = getSecurityPoolLinkHref(securityPoolAddress, 'fork-workflow', 12n)
		const hrefUrl = new URL(href, 'http://localhost')
		const hrefSearch = hrefUrl.hash.includes('?') ? hrefUrl.hash.slice(hrefUrl.hash.indexOf('?')) : ''
		const hrefSearchParams = new URLSearchParams(hrefSearch)

		expect(hrefUrl.hash.startsWith('#/security-pools')).toBe(true)
		expect(hrefSearchParams.get('securityPool')).toBe(securityPoolAddress)
		expect(hrefSearchParams.get('securityPoolsView')).toBe('operate')
		expect(hrefSearchParams.get('selectedPoolView')).toBe('fork-workflow')
		expect(hrefSearchParams.get('universe')).toBe('12')
	})

	test('preserves the current selected pool view when the caller does not provide one', () => {
		const securityPoolAddress = getAddress('0x0000000000000000000000000000000000000201')
		const href = getSecurityPoolLinkHref(securityPoolAddress)
		const hrefUrl = new URL(href, 'http://localhost')
		const hrefSearch = hrefUrl.hash.includes('?') ? hrefUrl.hash.slice(hrefUrl.hash.indexOf('?')) : ''
		const hrefSearchParams = new URLSearchParams(hrefSearch)

		expect(hrefSearchParams.get('securityPool')).toBe(securityPoolAddress)
		expect(hrefSearchParams.get('securityPoolsView')).toBe('operate')
		expect(hrefSearchParams.get('selectedPoolView')).toBe('vaults')
		expect(hrefSearchParams.get('universe')).toBe('11')
	})
})
