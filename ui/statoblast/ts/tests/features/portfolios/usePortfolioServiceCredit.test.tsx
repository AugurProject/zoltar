import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { decodeFunctionData, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createMockReadClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { usePortfolioServiceCredit } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioServiceCredit.js'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { capitalSnapshot, token, capital, unit } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
async function setup(amount = unit) {
	const snapshot = capitalSnapshot()
	const source = capitalClient(snapshot)
	let credit = amount
	const requestedOwners: unknown[] = []
	const client = source.client.extend(() =>
		createMockReadClient(async request => {
			if (request.functionName === 'services') return capital
			if (request.functionName === 'pullCreditsAttoEth') {
				requestedOwners.push(request.args?.[0])
				return credit
			}
			throw new Error('Unexpected reimbursement read')
		}),
	)
	installActiveEnvironmentForTesting({ ...source.backend, createReadClient: () => client })
	const requests: PortfolioTransaction[] = []
	const actions = {
		runPortfolioAction: async (_action: string, _label: string, build: () => PortfolioTransaction | Promise<PortfolioTransaction>) => {
			requests.push(await build())
		},
	}
	const parameters: Parameters<typeof usePortfolioServiceCredit>[0] = { model: { snapshot, setup: undefined, loading: false, discovering: false, error: undefined, managerInput: snapshot.portfolio }, actions, accountAddress: token }
	const hook = await renderHookWithProps(usePortfolioServiceCredit, parameters)
	lifecycle.trackRendered(hook)
	await waitFor(() => expect(hook.state().loading).toBe(false))
	return {
		hook,
		requests,
		requestedOwners,
		model: parameters.model,
		snapshot,
		setCredit: (value: bigint) => {
			credit = value
		},
	}
}

test.each([
	['discovery', { discovering: true, managerInput: '' }, true, 'Loading portfolio details…'],
	['account read', { loading: true }, true, 'Loading portfolio details…'],
	['empty selection', { managerInput: '' }, false, 'Enter a portfolio address above.'],
	['failed discovery', { error: 'Unable to discover the portfolio.', managerInput: '' }, false, 'Unable to discover the portfolio.'],
	['failed account read', { error: 'Portfolio RPC unavailable.' }, false, 'Portfolio RPC unavailable.'],
])('service reimbursement distinguishes portfolio %s', async (_state, overrides, loading, reason) => {
	const { hook, model, requests } = await setup()
	await hook.setProps({ model: { ...model, snapshot: undefined, ...overrides } })
	expect(hook.state().loading).toBe(loading)
	expect(hook.state().reason).toBe(reason)
	expect(hook.state().amount).toBeUndefined()
	await expect(hook.state().claim()).rejects.toThrow(reason)
	expect(requests).toHaveLength(0)
})
test.each([1, 3])('service reimbursement directs incomplete setup stage %s to preparation without claiming it is loading', async stage => {
	const { hook, model, snapshot } = await setup()
	await hook.setProps({ model: { ...model, snapshot: undefined, setup: { ...snapshot, stage } } })
	expect(hook.state().loading).toBe(false)
	expect(hook.state().reason).toBe('Complete the portfolio setup above.')
})

test('service reimbursement uses the connected wallet independently of the selected owner or question', async () => {
	const { hook, requests, requestedOwners, setCredit } = await setup()
	expect(hook.state().reason).toBeUndefined()
	expect(requestedOwners).toEqual([token])
	await act(() => hook.state().claim())
	const request = requests[0]
	if (request === undefined) throw new Error('Reimbursement request missing')
	expect(request).toMatchObject({ account: token, to: capital, value: 0n })
	expect(decodeFunctionData({ abi: parseAbi(['function claimServiceCredit(address recipient)']), data: request.data })).toEqual({ functionName: 'claimServiceCredit', args: [token] })
	expect(request.reviewDescription).toContain(`1 ETH of service reimbursements to your wallet ${token}`)
	await request.validateBeforeSubmit?.()
	setCredit(0n)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Service reimbursement changed')
})
test('zero credits remain visible but disable the reimbursement action', async () => {
	const { hook, requests } = await setup(0n)
	expect(hook.state().amount).toBe(0n)
	expect(hook.state().reason).toContain('No service reimbursement')
	await expect(hook.state().claim()).rejects.toThrow('No service reimbursement')
	expect(requests).toHaveLength(0)
})
