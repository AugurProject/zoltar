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
	'function withdrawPrincipal(uint256 amount,address recipient)',
	'function authorize(uint256 commitment)',
	'function setHealthTarget(uint256 targetHealthFactorBps)',
	'function claimEarnings()',
	'function requestRetirement(uint96 id)',
	'function cancelRetirement(uint96 id)',
	'function withdrawExecutionReserve(uint256 amount)',
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
test('stale prices block live-principal withdrawal and authorization while preserving earned fees', async () => {
	const { hook, requests } = await setup(capitalSnapshot({ priceValid: false, withdrawableAttoRep: 0n }))
	await act(() => {
		hook.state().setCommitmentAmount('10')
		hook.state().setWithdrawalAmount('4')
	})
	expect(hook.state().authorizeReason).toContain('price')
	expect(hook.state().withdrawReason).toContain('price')
	await act(() => hook.state().claim())
	expect(requests).toHaveLength(1)
	expect(hook.state().serveReason).toContain('price')
})
test('personal health and exact commitment consent are rechecked after the review opens', async () => {
	const { hook, requests, transport } = await setup()
	await act(() => {
		hook.state().setCommitmentAmount('10')
	})
	expect(hook.state().authorizeReason).toBeUndefined()
	await act(() => hook.state().authorize())
	const request = requests[0]
	if (request === undefined) throw new Error('Missing authorization')
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'authorize', args: [10n * unit] })
	await request.validateBeforeSubmit?.()
	transport.setSnapshot(capitalSnapshot({ ownerAccount: { ...capitalSnapshot().ownerAccount, targetHealthFactorBps: 15_000n } }))
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('health target changed')
	transport.setSnapshot(capitalSnapshot({ ownerPrincipalAttoRep: 31n * unit }))
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('principal changed')
})
test('custom admission blocks new underwriting while keeping existing owners exits available', async () => {
	const snapshot = capitalSnapshot()
	const { hook } = await setup({ ...snapshot, admission: { address: snapshot.questionAdmissionPolicy, mode: 'custom' } })
	await act(() => {
		hook.state().setDepositAmount('1')
		hook.state().setCommitmentAmount('10')
		hook.state().setWithdrawalAmount('1')
	})
	expect(hook.state().fundingReason).toContain('supports open or fixed')
	expect(hook.state().authorizeReason).toContain('supports open or fixed')
	expect(hook.state().withdrawReason).toBeUndefined()
	expect(hook.state().claimReason).toBeUndefined()
})
test('single owner position retains its retirement cohort and account changes clear drafts', async () => {
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

test('withdrawals use the on-chain allowance and recheck it before submission', async () => {
	const { hook, requests, transport } = await setup()
	await act(() => hook.state().setWithdrawalAmount('4'))
	expect(hook.state().withdrawReason).toBeUndefined()
	await act(() => hook.state().withdraw())
	const request = requests[0]
	if (request === undefined) throw new Error('Withdrawal request missing')
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'withdrawPrincipal', args: [4n * unit, owner] })
	await request.validateBeforeSubmit?.()
	transport.setSnapshot(capitalSnapshot({ withdrawableAttoRep: 3n * unit }))
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('withdrawable REP')
})

test('fully retired principal can withdraw without a fresh price', async () => {
	const { hook, requests } = await setup(capitalSnapshot({ priceValid: false, ownerCommitmentAttoEth: 0n, ownerPrincipalAttoRep: 30n * unit, positions: [], ownerAccount: { ...capitalSnapshot().ownerAccount, freeAttoRep: 30n * unit, positionId: 0n }, withdrawableAttoRep: 30n * unit }))
	await act(() => hook.state().setWithdrawalAmount('30'))
	expect(hook.state().withdrawReason).toBeUndefined()
	await act(() => hook.state().withdraw())
	expect(requests).toHaveLength(1)
})

test('an exported owner cannot fund a reserve that already followed the fork choice', async () => {
	const { hook } = await setup(capitalSnapshot({ exported: true }))
	await act(() => {
		hook.state().setReserveAmount('1')
		hook.state().setReserveWithdrawal('1')
	})
	expect(hook.state().fundReserveReason).toContain('fork choice')
	expect(hook.state().withdrawReserveReason).toContain('fork choice')
})

test('an open fork choice keeps assigned reserves locked while allowing unassigned withdrawals', async () => {
	const { hook } = await setup(capitalSnapshot({ forkTime: 500n, forkChoiceDeadline: 1_001n }))
	await act(() => hook.state().setReserveWithdrawal('1.01'))
	expect(hook.state().withdrawReserveReason).toContain('after the fork-choice deadline')
	await act(() => hook.state().setReserveWithdrawal('1'))
	expect(hook.state().withdrawReserveReason).toBeUndefined()
})

test('a missed fork choice unlocks assigned execution reserve and revalidates it before submission', async () => {
	const snapshot = { ...capitalSnapshot(), forkTime: 500n, forkChoiceDeadline: 1_000n, withdrawableExecutionReserveAttoEth: (101n * unit) / 100n }
	const { hook, requests, transport } = await setup(snapshot)
	await act(() => hook.state().setReserveWithdrawal('1.01'))
	expect(hook.state().withdrawReserveReason).toBeUndefined()
	await act(() => hook.state().withdrawReserve())
	const request = requests[0]
	if (request === undefined) throw new Error('Execution withdrawal request missing')
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'withdrawExecutionReserve', args: [(101n * unit) / 100n] })
	await request.validateBeforeSubmit?.()
	transport.setSnapshot({ ...snapshot, exported: true, withdrawableExecutionReserveAttoEth: 0n })
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('fork choice')
	transport.setSnapshot({ ...snapshot, ownerAccount: { ...snapshot.ownerAccount, executionReserveAttoEth: 0n }, withdrawableExecutionReserveAttoEth: unit / 100n })
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('withdrawable execution reserve')
})
