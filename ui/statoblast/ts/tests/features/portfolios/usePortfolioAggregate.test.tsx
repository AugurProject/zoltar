import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { decodeFunctionData, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { usePortfolioAggregate } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioAggregate.js'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { capitalSnapshot, owner, capital, unit } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const abi = parseAbi([
	'function approve(address spender,uint256 amount)',
	'function depositFor(address owner,uint256 amount)',
	'function withdrawFree(uint256 amount,address recipient)',
	'function authorize(uint256 rep,uint256 commitment)',
	'function setHealthTarget(uint256 targetHealthFactorBps)',
	'function claimEarnings()',
	'function requestRetirement(uint96 id)',
	'function cancelRetirement(uint96 id)',
])
async function setup(snapshot = capitalSnapshot()) {
	const transport = capitalClient(snapshot)
	transport.install()
	const requests: PortfolioTransaction[] = []
	const actions = {
		ownerReason: undefined,
		runPortfolioAction: async (_action: string, _title: string, build: () => PortfolioTransaction | Promise<PortfolioTransaction>) => {
			requests.push(await build())
		},
	}
	const hook = await renderHookWithProps((props: { snapshot: typeof snapshot; account: typeof owner | undefined }) => usePortfolioAggregate({ snapshot: props.snapshot, loading: false, error: undefined, refresh: async () => undefined }, actions, props.account), { snapshot, account: owner })
	lifecycle.trackRendered(hook)
	return { hook, requests, transport }
}
test('approval and deposit remain separate transactions with exact capital-ledger custody', async () => {
	const { hook, requests } = await setup()
	await act(() => hook.state().setDepositAmount('5'))
	expect(hook.state().depositReason).toContain('Approve')
	await act(() => hook.state().approve(7n * unit))
	expect(requests).toHaveLength(1)
	const approval = requests[0]
	if (approval === undefined) throw new Error('Missing approval')
	expect(decodeFunctionData({ abi, data: approval.data })).toEqual({ functionName: 'approve', args: [capital, 7n * unit] })
	await hook.setProps({ snapshot: capitalSnapshot({ allowanceAttoRep: 7n * unit }) })
	expect(hook.state().depositAmount).toBe('5')
	await act(() => hook.state().deposit())
	const deposit = requests[1]
	if (deposit === undefined) throw new Error('Missing deposit')
	expect(deposit.to).toBe(capital)
	expect(decodeFunctionData({ abi, data: deposit.data })).toEqual({ functionName: 'depositFor', args: [owner, 5n * unit] })
	expect(requests).toHaveLength(2)
})
test('stale prices disable new commitments but preserve free REP withdrawal, top-up and earned fees', async () => {
	const { hook, requests } = await setup(capitalSnapshot({ priceValid: false }))
	await act(() => {
		hook.state().setPledgeAmount('30')
		hook.state().setCommitmentAmount('10')
		hook.state().setWithdrawalAmount('4')
		hook.state().setTopUp(1n, '1')
	})
	expect(hook.state().authorizeReason).toContain('price')
	expect(hook.state().withdrawReason).toBeUndefined()
	expect(hook.state().positionReasons(1n).topUp).toBeUndefined()
	await act(() => hook.state().withdraw())
	await act(() => hook.state().claim())
	expect(requests).toHaveLength(2)
	expect(hook.state().serveReason).toContain('price')
})
test('personal health and exact commitment consent are rechecked after the review opens', async () => {
	const { hook, requests, transport } = await setup()
	await act(() => {
		hook.state().setPledgeAmount('30')
		hook.state().setCommitmentAmount('10')
	})
	expect(hook.state().authorizeReason).toBeUndefined()
	await act(() => hook.state().authorize())
	const request = requests[0]
	if (request === undefined) throw new Error('Missing authorization')
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'authorize', args: [30n * unit, 10n * unit] })
	await request.validateBeforeSubmit?.()
	transport.setSnapshot(capitalSnapshot({ ownerAccount: { ...capitalSnapshot().ownerAccount, targetHealthFactorBps: 15_000n } }))
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('health target changed')
})
test('custom admission blocks new underwriting while keeping existing owners exits available', async () => {
	const snapshot = capitalSnapshot()
	const { hook } = await setup({ ...snapshot, admission: { address: snapshot.questionAdmissionPolicy, mode: 'custom' } })
	await act(() => {
		hook.state().setDepositAmount('1')
		hook.state().setPledgeAmount('30')
		hook.state().setCommitmentAmount('10')
		hook.state().setWithdrawalAmount('1')
	})
	expect(hook.state().fundingReason).toContain('supports open or fixed')
	expect(hook.state().authorizeReason).toContain('supports open or fixed')
	expect(hook.state().withdrawReason).toBeUndefined()
	expect(hook.state().claimReason).toBeUndefined()
})
test('position retirement uses bounded cohort slots and account changes clear drafts', async () => {
	const { hook, requests } = await setup()
	expect(hook.state().positionReasons(1n).retire).toBeUndefined()
	await act(() => hook.state().retire(1n))
	const request = requests[0]
	if (request === undefined) throw new Error('Missing retirement')
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'requestRetirement', args: [1n] })
	await act(() => hook.state().setDepositAmount('5'))
	await hook.setProps({ snapshot: capitalSnapshot({ universeId: 2n }) })
	expect(hook.state().depositAmount).toBe('')
})
