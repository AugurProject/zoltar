import { describe, expect, test } from 'bun:test'
import { shouldRenderAppRouteContent } from '../../app/lib/appRouteGate.js'

describe('shouldRenderAppRouteContent', () => {
	test('allows the deployment route through a read-backend error', () => {
		expect(shouldRenderAppRouteContent('deploy', 'Wrong network')).toBeTrue()
	})

	test('blocks application routes while the read backend is unavailable', () => {
		expect(shouldRenderAppRouteContent('zoltar', 'Wrong network')).toBeFalse()
		expect(shouldRenderAppRouteContent('security-pools', 'Wrong network')).toBeFalse()
	})

	test('allows all routes when the read backend is available', () => {
		expect(shouldRenderAppRouteContent('not-found', undefined)).toBeTrue()
	})
})
