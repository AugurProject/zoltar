import { expect, test } from 'bun:test'
import { assertDocsHtmlValid } from './check-docs-html.mts'

test('docs HTML diagrams, equations, and local links are structurally valid', async () => {
	await expect(assertDocsHtmlValid()).resolves.toBeUndefined()
})
