import { expect, test } from 'bun:test'
import { parseStatoblastPage } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { formatAppDocumentTitle, getAppPageTitle } from '../../app/lib/appPageTitle.js'

test('new Statoblast routes have informative titles, and removed routes use the not-found title', () => {
	const pool = '0x1111111111111111111111111111111111111111'
	for (const [hash, title] of [
		['#/watchlist', 'Watchlist'],
		['#/migrate-rep', 'Migrate REP'],
		['#/deploy-pool', 'Deploy a security pool'],
		[`#/pool/${pool}/price`, 'REP price'],
		[`#/pool/${pool}/question/10/reporting`, 'Reporting'],
		['#/security-pools', 'Page not found'],
	] as const)
		expect(formatAppDocumentTitle(getAppPageTitle(parseStatoblastPage(hash)))).toBe(`${title} | Augur Statoblast`)
})
