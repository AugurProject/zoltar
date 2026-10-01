import { expect, test } from 'bun:test'
import { categorizedDashboardError, publicDashboardError } from '../src/dashboard/public-error.ts'

function namedError(name: string, message: string) {
	const error = new Error(message)
	error.name = name
	return error
}

const categories = { SignerOperationBusy: { body: { error: 'Busy' }, status: 423 } }
const uncategorized = (error: unknown) => ({ body: { error: error instanceof Error ? error.message : 'Unknown' }, status: 400 })

test('categorized dashboard errors answer with the category named by the error and fall back otherwise', async () => {
	const busy = categorizedDashboardError('chaos', 'mutation:/api/paused', namedError('SignerOperationBusy', 'sensitive lock path'), categories, uncategorized)
	expect(busy.status).toBe(423)
	expect(await busy.json()).toEqual({ error: 'Busy' })
	const validation = categorizedDashboardError('chaos', 'mutation:/api/settings', new Error('Field is invalid'), categories, uncategorized)
	expect(validation.status).toBe(400)
	expect(await validation.json()).toEqual({ error: 'Field is invalid' })
	// Inherited object keys never select a category.
	const inherited = categorizedDashboardError('chaos', 'mutation:/api/settings', namedError('constructor', 'Prototype name'), categories, uncategorized)
	expect(inherited.status).toBe(400)
	expect(await inherited.json()).toEqual({ error: 'Prototype name' })
})

test('public dashboard errors answer with the fallback and the requested status', async () => {
	const response = publicDashboardError('liquidator', new Error('sensitive /home/operator path'), 503, 'state-read', 'State is unavailable.')
	expect(response.status).toBe(503)
	expect(await response.json()).toEqual({ error: 'State is unavailable.' })
})
