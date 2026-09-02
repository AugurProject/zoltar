/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { STATOBLAST_NOT_FOUND_LINKS } from '../../app/components/AppRouteContent.js'

describe('Statoblast AppRouteContent', () => {
	test('offers only Statoblast-local recovery links', () => {
		expect(STATOBLAST_NOT_FOUND_LINKS).toEqual([
			{ href: '#/deploy', label: 'Deploy' },
			{ href: '#/security-pools', label: 'Security Pools' },
			{ href: '#/security-pools?securityPoolsView=universes', label: 'Universe' },
			{ href: '#/open-oracle', label: 'Open Oracle' },
		])
	})
})
