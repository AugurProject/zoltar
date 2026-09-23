import { expect, test } from 'bun:test'
import { reviewChangeRows } from '../../src/dashboard/confirmation.ts'

test('review shows exact nested before and after settings', () => {
	expect(reviewChangeRows({ limits: { lockedWeth: '1.000000000000000001' }, pools: [{ questionId: '1' }] }, { limits: { lockedWeth: '2' }, pools: [{ questionId: '2' }] })).toEqual([
		{ label: 'Setting › limits › lockedWeth', before: '1.000000000000000001', after: '2' },
		{ label: 'Setting › pools › 1 › questionId', before: '1', after: '2' },
	])
})
