/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAppPageTitle } from '../../app/lib/appPageTitle.js'

describe('statoblast document title', () => {
	test('titles the route with its visible heading', () => {
		expect(getAppPageTitle({ activeSecurityPoolsView: 'browse', route: 'pools' })).toBe('Portfolio questions')
		expect(getAppPageTitle({ activeSecurityPoolsView: 'browse', route: 'open-oracle' })).toBe('Price reports')
	})

	test('names the portfolio route', () => {
		expect(getAppPageTitle({ activeSecurityPoolsView: 'browse', route: 'portfolios' })).toBe('Portfolios')
	})
})
