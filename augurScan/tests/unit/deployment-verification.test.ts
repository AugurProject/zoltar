import { expect, test } from 'bun:test'
import { bundledComposeSourceUrl } from '../src/deployment-verification.ts'

const configuration = (url?: string): Record<string, unknown> => ({
	services: {
		app: {
			environment: url === undefined ? {} : { POSTGRES_URL: url },
		},
	},
})

test('accepts only the exact bundled PostgreSQL source from resolved Compose configuration', () => {
	const expected = 'postgres://augurscan:secret@postgres:5432/augurscan'
	expect(bundledComposeSourceUrl(configuration(expected))).toBe(expected)
	for (const invalid of [
		'postgres://other:secret@postgres:5432/augurscan',
		'postgres://augurscan:secret@other:5432/augurscan',
		'postgres://augurscan:secret@postgres:5433/augurscan',
		'postgres://augurscan:secret@postgres:5432/other',
		'not-a-url',
	])
		expect(() => bundledComposeSourceUrl(configuration(invalid))).toThrow('Bundled mode requires the resolved app POSTGRES_URL')
	expect(() => bundledComposeSourceUrl(configuration())).toThrow('Resolved Compose app POSTGRES_URL is unavailable')
	expect(() => bundledComposeSourceUrl({})).toThrow('Resolved Compose app POSTGRES_URL is unavailable')
})
