import { expect, test } from 'bun:test'
import { canonicalOperationsPath, classifyRoute, parseOperationsDetailRoute, routeTitle, sectionLinkTarget, systemRouteIdentity } from '../../browser/routes.ts'

test('classifies canonical entities and rejects unknown routes', () => {
	expect(classifyRoute('/pool/0x1111111111111111111111111111111111111111')).toBe('operations')
	expect(classifyRoute('/question/501')).toBe('system')
	expect(routeTitle('/question/501')).toBe('Question 0x1f5 · augurScan')
	expect(classifyRoute('/tx/0x' + 'a'.repeat(64))).toBe('explorer')
	expect(classifyRoute('/operations/unknown')).toBe('not-found')
	expect(routeTitle('/missing')).toBe('Page not found · augurScan')
})

test('question and universe routes accept the displayed hex ID and load it by its decimal ID', () => {
	expect(classifyRoute('/question/0x1f5')).toBe('system')
	expect(systemRouteIdentity('0x1f5')).toBe('501')
	expect(systemRouteIdentity('501')).toBe('501')
	expect(systemRouteIdentity(`0x${'f'.repeat(64)}`)).toBe((2n ** 256n - 1n).toString())
	expect(systemRouteIdentity((2n ** 256n).toString())).toBeUndefined()
	expect(systemRouteIdentity('question-501')).toBeUndefined()
	expect(classifyRoute('/question/0x1f5g')).toBe('not-found')
	expect(classifyRoute(`/universe/0x${'1'.repeat(65)}`)).toBe('not-found')
})

test('a section link keeps the historical block only for the section already shown', () => {
	const current = new URL('https://scanner.test/operations/risk?chainId=1&atBlock=108#capital')
	expect(sectionLinkTarget(new URL('https://scanner.test/operations/risk'), current).href).toBe('https://scanner.test/operations/risk?chainId=1&atBlock=108')
	expect(sectionLinkTarget(new URL('https://scanner.test/operations/reports'), current).href).toBe('https://scanner.test/operations/reports?chainId=1')
})

test('maps old operations detail links to one canonical route', () => {
	expect(canonicalOperationsPath('/operations/risk/pool/0x1111111111111111111111111111111111111111')).toBe('/pool/0x1111111111111111111111111111111111111111')
	expect(canonicalOperationsPath('/operations/report/0x1111111111111111111111111111111111111111/1842')).toBe('/report/0x1111111111111111111111111111111111111111/1842')
	expect(parseOperationsDetailRoute('/report/0x1111111111111111111111111111111111111111/1842')).toEqual({ kind: 'report', identity: ['0x1111111111111111111111111111111111111111', '1842'] })
})
