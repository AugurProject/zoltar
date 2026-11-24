import { expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { parseStatoblastPage, poolTabs, questionTabs, statoblastPageHash } from '@zoltar/ui-statoblast-shared/lib/routing.js'

const pool = getAddress('0x1111111111111111111111111111111111111111')

test('resolves every shared Statoblast screen and rejects removed routes', () => {
	expect(parseStatoblastPage('').kind).toBe('choose-universe')
	for (const kind of ['watchlist', 'migrate-rep', 'deploy-pool'] as const) expect(parseStatoblastPage(`#/${kind}`).kind).toBe(kind)
	for (const tab of poolTabs) {
		const page = { kind: 'pool', pool, tab } as const
		expect(parseStatoblastPage(statoblastPageHash(page))).toEqual(page)
	}
	for (const tab of questionTabs) {
		const page = { kind: 'question', pool, questionId: 9n, tab } as const
		expect(parseStatoblastPage(statoblastPageHash(page))).toEqual(page)
	}
	for (const hash of ['#/pools', `#/pools/${pool}`, '#/security-pools', '#/deploy', '#/open-oracle', '#/pool/invalid', `#/pool/${pool}/question/-1/shares`, `#/pool/${pool}/question/0x1/trading`]) {
		expect(parseStatoblastPage(hash).kind).toBe('not-found')
	}
})

test('accepts explicit share actions only on the Shares route', () => {
	const page = { kind: 'question', pool, questionId: 9n, tab: 'shares' } as const
	const hash = statoblastPageHash(page)
	expect(parseStatoblastPage(`${hash}?action=mint`)).toEqual({ ...page, sharesAction: 'mint' })
	expect(parseStatoblastPage(`${hash}?action=redeem`)).toEqual({ ...page, sharesAction: 'redeem' })
	expect(parseStatoblastPage(`${hash}?action=withdraw`)).toEqual(page)
	expect(parseStatoblastPage(`${statoblastPageHash({ ...page, tab: 'reporting' })}?action=mint`)).toEqual({ ...page, tab: 'reporting' })
})
