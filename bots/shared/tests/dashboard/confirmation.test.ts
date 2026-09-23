import { expect, test } from 'bun:test'
import { reviewChangeRows } from '../../src/dashboard/confirmation.ts'

test('review shows exact nested before and after settings', () => {
	expect(reviewChangeRows({ limits: { lockedWeth: '1.000000000000000001' }, pools: [{ questionId: '1' }] }, { limits: { lockedWeth: '2' }, pools: [{ questionId: '2' }] })).toEqual([
		{ label: 'Setting › limits › lockedWeth', before: '1.000000000000000001', after: '2' },
		{ label: 'Setting › pools › 1 › questionId', before: '1', after: '2' },
	])
})

test('review expands added and removed sources into their fields', () => {
	expect(reviewChangeRows({ sources: [] }, { sources: [{ address: '0xabc', minimumDepthEth: '2' }] })).toEqual([
		{ label: 'Setting › sources › 1 › address', before: '—', after: '0xabc' },
		{ label: 'Setting › sources › 1 › minimumDepthEth', before: '—', after: '2' },
	])
	expect(reviewChangeRows({ sources: [{ address: '0xabc', minimumDepthEth: '2' }] }, { sources: [] })).toEqual([
		{ label: 'Setting › sources › 1 › address', before: '0xabc', after: '—' },
		{ label: 'Setting › sources › 1 › minimumDepthEth', before: '2', after: '—' },
	])
})
