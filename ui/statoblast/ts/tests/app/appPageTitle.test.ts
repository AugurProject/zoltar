/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { formatAppDocumentTitle, getPoolDocumentTitleDetail } from '../../app/lib/appPageTitle.js'

const POOL_ADDRESS = '0xa83562266e1514927697d5118C8777828860aD73'

describe('statoblast document title', () => {
	test('names the open pool by its question once that pool has loaded', () => {
		const detail = getPoolDocumentTitleDetail({ requestedPoolAddress: POOL_ADDRESS, selectedPool: { marketDetails: { title: 'Will ETH close above 5k?' }, securityPoolAddress: POOL_ADDRESS.toLowerCase() } })
		expect(detail).toBe('Will ETH close above 5k?')
		expect(formatAppDocumentTitle('Security pool', detail)).toBe('Will ETH close above 5k? · Security pool | Augur Statoblast')
	})

	test('names the open pool by its short address while it loads or when another pool is still selected', () => {
		expect(getPoolDocumentTitleDetail({ requestedPoolAddress: POOL_ADDRESS, selectedPool: undefined })).toBe('0xa83562…60aD73')
		expect(getPoolDocumentTitleDetail({ requestedPoolAddress: POOL_ADDRESS, selectedPool: { marketDetails: { title: 'Other pool' }, securityPoolAddress: '0x0000000000000000000000000000000000000001' } })).toBe('0xa83562…60aD73')
	})

	test('keeps the plain page title without a pool', () => {
		expect(getPoolDocumentTitleDetail({ requestedPoolAddress: '', selectedPool: undefined })).toBeUndefined()
		expect(getPoolDocumentTitleDetail({ requestedPoolAddress: 'not-an-address', selectedPool: undefined })).toBeUndefined()
		expect(formatAppDocumentTitle('Security pools')).toBe('Security pools | Augur Statoblast')
	})
})
