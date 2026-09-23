import { expect, test } from 'bun:test'
import { canonicalOperationsPath, classifyRoute, parseOperationsDetailRoute, routeTitle } from '../../browser/routes.ts'

test('classifies canonical entities and rejects unknown routes', () => {
	expect(classifyRoute('/pool/0x1111111111111111111111111111111111111111')).toBe('operations')
	expect(classifyRoute('/question/501')).toBe('system')
	expect(classifyRoute('/tx/0x' + 'a'.repeat(64))).toBe('explorer')
	expect(classifyRoute('/operations/unknown')).toBe('not-found')
	expect(routeTitle('/missing')).toBe('Page not found · augurScan')
})

test('maps old operations detail links to one canonical route', () => {
	expect(canonicalOperationsPath('/operations/risk/pool/0x1111111111111111111111111111111111111111')).toBe('/pool/0x1111111111111111111111111111111111111111')
	expect(canonicalOperationsPath('/operations/report/0x1111111111111111111111111111111111111111/1842')).toBe('/report/0x1111111111111111111111111111111111111111/1842')
	expect(parseOperationsDetailRoute('/report/0x1111111111111111111111111111111111111111/1842')).toEqual({ kind: 'report', identity: ['0x1111111111111111111111111111111111111111', '1842'] })
})
