import type { OperationsResponse } from './api-validation.ts'

interface OperationsRenderInputs {
	readonly chainId: string
	readonly url: URL
	readonly networkName: string | undefined
	readonly liveConnected: boolean
}

// Opaque continuation cursors embed the snapshot block, so they change on every block although the page only shows whether one exists.
const withoutCursorValues = (key: string, value: unknown): unknown => (typeof value === 'string' && /cursor$/iu.test(key) ? 'cursor' : value)

/**
 * Identifies everything an Operations page renders from a response. The block number, observed head, and lag change on every block
 * but are shown only for a historical snapshot, and the detail tab switches in place, so neither forces a re-render on its own.
 */
export const operationsRenderSignature = (response: OperationsResponse, inputs: OperationsRenderInputs): string => {
	const { asOf, data } = response
	const historical = asOf['historical'] === true || asOf['phase'] === 'historical'
	const url = new URL(inputs.url)
	url.searchParams.delete('tab')
	return JSON.stringify([inputs.chainId, url.pathname, url.search, inputs.networkName, historical ? { asOf, liveConnected: inputs.liveConnected } : false, data], withoutCursorValues)
}
