/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
	DEPLOY_ROUTE,
	OPEN_ORACLE_ROUTE,
	buildRouteHref,
	ensureRouteHash,
	getCurrentRoute,
	getCurrentRouteHash,
	getRouteHash,
	getRouteHashSearch,
	SECURITY_POOLS_ROUTE,
	ZOLTAR_ROUTE,
} from '../lib/routing.js'
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

	test('resolves route defaults and unknown routes', () => {
		window.location.hash = ''
		expect(getCurrentRoute()).toBe('zoltar')
		expect(getCurrentRouteHash()).toBe(ZOLTAR_ROUTE)
		expect(getRouteHashSearch('')).toBe('')

		window.location.hash = '#/does-not-exist?simulate=1'
		expect(getCurrentRoute()).toBe('not-found')
	})

	test('ensureRouteHash seeds default hash when blank', () => {
		window.location.hash = ''
		ensureRouteHash()
		expect(window.location.hash).toBe(ZOLTAR_ROUTE)
	})

	test('resolves known and non-query route hash helpers', () => {
		expect(getCurrentRouteHash()).toBe(ZOLTAR_ROUTE)
		window.location.hash = SECURITY_POOLS_ROUTE
		expect(getCurrentRoute()).toBe('security-pools')
		expect(getCurrentRouteHash()).toBe(SECURITY_POOLS_ROUTE)
		expect(getRouteHashSearch()).toBe('')
	})

	test('returns canonical route hashes for known routes', () => {
		expect(DEPLOY_ROUTE).toBe('#/deploy')
		expect(OPEN_ORACLE_ROUTE).toBe('#/open-oracle')
		expect(getRouteHash('deploy')).toBe(DEPLOY_ROUTE)
		expect(getRouteHash('security-pools')).toBe(SECURITY_POOLS_ROUTE)
		expect(getRouteHash('open-oracle')).toBe(OPEN_ORACLE_ROUTE)
		expect(getRouteHash('zoltar')).toBe(ZOLTAR_ROUTE)
	})
})
