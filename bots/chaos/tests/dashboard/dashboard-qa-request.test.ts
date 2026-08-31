import { resolve } from 'node:path'
import { expect, test } from 'bun:test'

const captureScript = resolve(import.meta.dir, '../../scripts/capture-dashboard-qa.mts')
const baseRequest = { catalogDetail: true, height: 844, name: 'invalid-request', width: 390 }

test.each([
	['a whitespace-padded exact operation ID', { ...baseRequest, catalogOperationId: ' surface.weth9.receive', route: 'catalog' }],
	['a targeted operation on a non-catalog route', { ...baseRequest, catalogOperationId: 'surface.weth9.receive', route: 'overview' }],
	['catalog detail mode on a non-catalog route', { ...baseRequest, route: 'overview' }],
	['an expected explanation without an exact operation ID', { ...baseRequest, catalogExpectedExplanation: 'Expected explanation', route: 'catalog' }],
	['a whitespace-padded expected explanation', { ...baseRequest, catalogExpectedExplanation: ' Expected explanation', catalogOperationId: 'surface.weth9.receive', route: 'catalog' }],
	['submission readiness on a non-overview route', { height: 844, name: 'invalid-submission-readiness', route: 'activity', submissionReadiness: 'ready', width: 390 }],
	['an unknown submission readiness state', { height: 900, name: 'invalid-submission-state', route: 'overview', submissionReadiness: 'unknown', width: 1_440 }],
])('rejects %s before launching browser QA', async (_label, request) => {
	const child = Bun.spawn([process.execPath, captureScript, JSON.stringify(request)], { stderr: 'pipe', stdout: 'pipe' })
	const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
	expect(exitCode).not.toBe(0)
	expect(stderr).toContain('Capture request fields are invalid')
})
