import { test } from 'bun:test'
import { expectHeaderNotices } from '../../../shared/tests/support/dashboard-header.ts'
import { operatorHeader } from '../../src/dashboard/header.ts'

test('keeps global notices in the header on every tab', async () => {
	await expectHeaderNotices(new URL('../../src/dashboard/index.html', import.meta.url), operatorHeader, ['global-error', 'operator-alerts'])
})
