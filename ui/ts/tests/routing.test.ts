/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { buildRouteHref, getCurrentRoute, getCurrentRouteHash, getRouteHashSearch, ZOLTAR_ROUTE } from '../lib/routing.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'

describe('routing', () => {
	let cleanup: (() => void) | undefined

	beforeEach(() => {
		cleanup = installDomEnvironment('http://localhost/#/zoltar?zoltarView=create&simulate=1').cleanup
	})

	afterEach(() => {
		cleanup?.()
		cleanup = undefined
	})

	test('reads route and route-backed params from the hash fragment', () => {
		expect(getCurrentRoute()).toBe('zoltar')
		expect(getCurrentRouteHash()).toBe(ZOLTAR_ROUTE)
		expect(getRouteHashSearch()).toBe('?zoltarView=create&simulate=1')
		expect(buildRouteHref(ZOLTAR_ROUTE, '?zoltarView=questions')).toBe('#/zoltar?zoltarView=questions')
	})
})
