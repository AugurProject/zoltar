import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { decodeFunctionData, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { usePortfolioAggregate } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioAggregate.js'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { auctionCapitalSnapshot, capitalSnapshot, owner, capital, unit } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const abi = parseAbi([
	'function approve(address spender,uint256 amount)',
	'function depositFor(address owner,uint256 amount)',
	'function depositPrincipal(address ledger,uint256 amount,uint256 targetHealthFactorBps)',
	'function withdrawPrincipal(uint256 amount,address recipient)',
	'function authorize(uint256 commitment)',
	'function authorizeWithReport(uint256 reportId,uint256 commitment)',
	'function setHealthTarget(uint256 targetHealthFactorBps)',
	'function depositAndSetHealthTarget(uint256 amount,uint256 targetHealthFactorBps)',
	'function claimEarnings()',
	'function requestRetirement(uint96 id,uint256 remainingCommitment)',
	'function serveRetirement(uint96 id)',
	'function cancelRetirement(uint96 id)',
	'function withdrawExecutionReserve(uint256 amount)',
	'function fundExecutionReserve(address owner) payable',
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
	const hook = await renderHookWithProps((props: { snapshot: typeof snapshot | undefined; account: typeof owner | undefined }) => usePortfolioAggregate({ snapshot: props.snapshot, loading: props.snapshot === undefined, error: undefined, refresh: async () => undefined }, actions, props.account), {
		snapshot,
		account: owner,
	})
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

test('an auction vault deposit pulls REP from its controlling wallet with approval to that vault', async () => {
	const snapshot = auctionCapitalSnapshot()
	const { hook, requests } = await setup(snapshot)
	await act(() => hook.state().setDepositAmount('5'))
	await act(() => hook.state().approve(7n * unit))
	const approval = requests[0]
	if (approval === undefined) throw new Error('Missing vault approval')
	expect(approval.account).toBe(owner)
	expect(decodeFunctionData({ abi, data: approval.data })).toEqual({ functionName: 'approve', args: [snapshot.owner, 7n * unit] })
	await hook.setProps({ snapshot: { ...snapshot, allowanceAttoRep: 7n * unit } })
	await act(() => hook.state().deposit())
	const deposit = requests[1]
	if (deposit === undefined) throw new Error('Missing vault deposit')
	expect(deposit).toMatchObject({ account: owner, to: snapshot.owner })
	expect(decodeFunctionData({ abi, data: deposit.data })).toEqual({ functionName: 'depositPrincipal', args: [capital, 5n * unit, snapshot.ownerAccount.targetHealthFactorBps] })
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
test('raising a saved health target requires present collateral and a fresh price', async () => {
	const { hook } = await setup()
	await act(() => hook.state().setHealthPercent('150'))
	expect(hook.state().healthReason).toContain('REP')
	await hook.setProps({ snapshot: capitalSnapshot({ priceValid: false }) })
	expect(hook.state().healthReason).toContain('price')
	await act(() => hook.state().setHealthPercent('100'))
	expect(hook.state().healthReason).toBeUndefined()
})
test('cancelling retirement cannot reopen capacity below the saved target or at a stale price', async () => {
	const snapshot = capitalSnapshot()
	const retiring = { ...snapshot, positions: snapshot.positions.map(position => ({ ...position, batch: 1n, rep: 24n * unit })), ownerPrincipalAttoRep: 24n * unit }
	const { hook } = await setup(retiring)
	expect(hook.state().positionReasons(1n).cancel).toContain('target')
	await hook.setProps({ snapshot: { ...retiring, priceValid: false } })
	expect(hook.state().positionReasons(1n).cancel).toContain('price')
})
test('commitment starts from funded target capacity and lowering a target never sends authorization', async () => {
	const { hook, requests } = await setup()
	expect(hook.state().commitmentAmount).toBe('11.904761904761904761')
	await act(() => hook.state().setHealthPercent('100'))
	expect(hook.state().commitmentAmount).toBe('14.285714285714285714')
	expect(hook.state().authorizeReason).toContain('Save your health target')
	await act(() => hook.state().setHealth())
	expect(requests).toHaveLength(1)
	const request = requests[0]
	if (request === undefined) throw new Error('Missing target request')
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'setHealthTarget', args: [10_000n] })
})
test('an atomic target raise previews the collateral shortfall and keeps approval separate', async () => {
	const { hook, requests, transport } = await setup()
	await act(() => hook.state().setHealthPercent('150'))
	expect(hook.state().healthDepositAmount).toBe('1.5')
	expect(hook.state().healthDepositReason).toContain('Approve')
	await act(() => hook.state().approveHealthDeposit(2n * unit))
	expect(requests).toHaveLength(1)
	const funded = capitalSnapshot({ allowanceAttoRep: 2n * unit })
	await hook.setProps({ snapshot: funded })
	transport.setSnapshot(funded)
	await act(() => hook.state().depositAndSetHealth())
	expect(requests).toHaveLength(2)
	const request = requests[1]
	if (request === undefined) throw new Error('Missing atomic target request')
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'depositAndSetHealthTarget', args: [(3n * unit) / 2n, 15_000n] })
	await request.validateBeforeSubmit?.()
	transport.setSnapshot({ ...funded, allowanceAttoRep: unit })
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Approve REP')
	transport.setSnapshot({ ...funded, priceValid: false })
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('price')
})
test('target-sized retirement sends a fixed residual without silently saving an unfunded target', async () => {
	const { hook, requests } = await setup()
	await act(() => hook.state().setHealthPercent('200'))
	expect(hook.state().healthReason).toContain('REP')
	await act(() => hook.state().retireToTarget())
	expect(hook.state().remainingCommitmentAmount).toBe('7.142857142857142857')
	await act(() => hook.state().retire(1n))
	expect(requests).toHaveLength(1)
	const request = requests[0]
	if (request === undefined) throw new Error('Missing partial retirement request')
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'requestRetirement', args: [1n, 7_142_857_142_857_142_857n] })
	expect(request.reviewDescription).toContain('saved health target stays unchanged')
})
test('target sizing rounds a small reduction up to a meaningful retirement unit', async () => {
	const { hook } = await setup()
	await act(() => hook.state().setHealthPercent('150'))
	await act(() => hook.state().retireToTarget())
	expect(hook.state().remainingCommitmentAmount).toBe('9')
	expect(hook.state().positionReasons(1n).retire).toBeUndefined()
})
test('idle principal sizes new authorization but cannot satisfy a live health raise or reduction', async () => {
	const base = capitalSnapshot()
	const snapshot = { ...base, ownerPrincipalAttoRep: 50n * unit, ownerAccount: { ...base.ownerAccount, freeAttoRep: 20n * unit } }
	const { hook } = await setup(snapshot)
	await act(() => hook.state().setHealthPercent('200'))
	expect(hook.state().targetCapacity).toBe(11_904_761_904_761_904_761n)
	expect(hook.state().healthReason).toContain('REP')
	expect(hook.state().healthDepositAmount).toBe('12')
	await act(() => hook.state().retireToTarget())
	expect(hook.state().remainingCommitmentAmount).toBe('7.142857142857142857')
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
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'requestRetirement', args: [1n, 0n] })
	await act(() => hook.state().setDepositAmount('5'))
	await hook.setProps({ snapshot: capitalSnapshot({ universeId: 2n }) })
	expect(hook.state().depositAmount).toBe('')
})

test('approval refresh preserves health and commitment drafts until the concrete account or saved target changes', async () => {
	const { hook } = await setup()
	await act(() => {
		hook.state().setHealthPercent('150')
		hook.state().setHealthDepositAmount('7')
		hook.state().setCommitmentAmount('6')
		hook.state().setRemainingCommitmentAmount('5')
	})
	await hook.setProps({ snapshot: undefined })
	await hook.setProps({ snapshot: capitalSnapshot({ allowanceAttoRep: 7n * unit }) })
	expect(hook.state().healthPercent).toBe('150')
	expect(hook.state().healthDepositAmount).toBe('7')
	expect(hook.state().commitmentAmount).toBe('6')
	expect(hook.state().remainingCommitmentAmount).toBe('5')
	await act(() => hook.state().setHealthPercent('200'))
	await hook.setProps({ snapshot: capitalSnapshot({ ownerAccount: { ...capitalSnapshot().ownerAccount, targetHealthFactorBps: 15_000n } }) })
	expect(hook.state().healthPercent).toBe('150')
	await hook.setProps({ snapshot: undefined })
	await hook.setProps({ snapshot: capitalSnapshot({ chainId: 2 }) })
	expect(hook.state().healthPercent).toBe('120')
	expect(hook.state().healthDepositAmount).toBe('0')
	expect(hook.state().remainingCommitmentAmount).toBe('0')
})

test('retirement service targets the owner request without pretending insufficient capacity completed it', async () => {
	const base = capitalSnapshot()
	const snapshot = { ...base, demandAttoEth: base.healthyCommitmentAttoEth, positions: base.positions.map(position => ({ ...position, batch: 1n, remainingCommitment: 5n * unit })) }
	const { hook, requests, transport } = await setup(snapshot)
	await act(() => hook.state().serve())
	const request = requests[0]
	if (request === undefined) throw new Error('Missing retirement service request')
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'serveRetirement', args: [1n] })
	expect(request.reviewDescription).toContain('your commitment remains unchanged')
	expect(hook.state().livePositions[0]).toMatchObject({ batch: 1n, commitment: 10n * unit, remainingCommitment: 5n * unit })
	await request.validateBeforeSubmit?.()
	transport.setSnapshot(base)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Retirement request changed')
})

test('retirement service without an owner request keeps the bounded global action', async () => {
	const { hook, requests } = await setup()
	await act(() => hook.state().serve())
	const request = requests[0]
	if (request === undefined) throw new Error('Missing global retirement service request')
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'serveRetirement', args: [0n] })
	expect(request.reviewDescription).toContain('Partial progress')
})

test('a retirement reviewed as ready is stopped if its capacity disappears before submission', async () => {
	const base = capitalSnapshot()
	const preview = { status: 'ready' as const, effectiveCurrentBatch: 1n, healthyCommitment: 20n * unit, spareCommitment: 10n * unit, queuedAheadCommitment: 0n, commitmentReduction: 5n * unit, releasedRep: 0n }
	const snapshot = { ...base, positions: base.positions.map(position => ({ ...position, batch: 1n, remainingCommitment: 5n * unit, retirementPreview: preview })) }
	const { hook, requests, transport } = await setup(snapshot)
	await act(() => hook.state().serve())
	const request = requests[0]
	if (request === undefined) throw new Error('Missing retirement request')
	await request.validateBeforeSubmit?.()
	transport.setSnapshot({ ...snapshot, demandAttoEth: 20n * unit, positions: snapshot.positions.map(position => ({ ...position, retirementPreview: { ...preview, status: 'insufficient-spare', spareCommitment: 0n } })) })
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Retirement capacity changed')
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

test('execution funding reviews live commitment and stops when its withdrawal terms change', async () => {
	const { hook, requests, transport } = await setup()
	await act(() => hook.state().setReserveAmount('1'))
	await act(() => hook.state().fundReserve())
	const request = requests[0]
	if (request === undefined) throw new Error('Execution funding request missing')
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'fundExecutionReserve', args: [owner] })
	expect(request.value).toBe(unit)
	expect(request.reviewDescription).toContain('committed to keeper work')
	expect(request.reviewDescription).toContain('full retirement')
	await request.validateBeforeSubmit?.()
	transport.setSnapshot(capitalSnapshot({ ownerCommitmentAttoEth: 0n }))
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Commitment status changed')
	expect(requests).toHaveLength(1)
})

test('funding before authorization remains withdrawable and cannot silently become committed', async () => {
	const snapshot = capitalSnapshot({ ownerCommitmentAttoEth: 0n, positions: [], ownerAccount: { ...capitalSnapshot().ownerAccount, positionId: 0n } })
	const { hook, requests, transport } = await setup(snapshot)
	await act(() => hook.state().setReserveAmount('1'))
	await act(() => hook.state().fundReserve())
	const request = requests[0]
	if (request === undefined) throw new Error('Execution funding request missing')
	expect(request.reviewDescription).toContain('remains withdrawable until you authorize')
	await request.validateBeforeSubmit?.()
	transport.setSnapshot(capitalSnapshot())
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Commitment status changed')
	transport.setSnapshot({ ...snapshot, exported: true })
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('fork choice')
	expect(requests).toHaveLength(1)
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

test('a selected funded report quotes collateral, authorizes explicitly, and is rechecked before sending', async () => {
	const snapshot = capitalSnapshot({ oracleExposureLimitAttoEth: 1n, ownerPrincipalAttoRep: 40n * unit })
	const { hook, requests, transport } = await setup(snapshot)
	transport.setRead('reportAuthorization', [3n * unit, 2n])
	await act(async () => {
		hook.state().setCommitmentAmount('10')
		hook.state().setReportInput('7')
	})
	await act(async () => {
		await new Promise(resolve => setTimeout(resolve, 20))
	})
	expect(hook.state().authorizeReason).toBeUndefined()
	expect(hook.state().requiredCollateral).toBe(37_800_000_000_000_000_000n)
	await act(() => hook.state().authorize())
	const request = requests[0]
	if (request === undefined) throw new Error('Missing report authorization')
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'authorizeWithReport', args: [7n, 10n * unit] })
	await request.validateBeforeSubmit?.()
	transport.setRead('reportAuthorization', [4n * unit, 2n])
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Report terms changed')
})

test('a higher funded report price resizes target capacity and settles after rechecking that exposure', async () => {
	const snapshot = capitalSnapshot({ oracleExposureLimitAttoEth: 1n, ownerPrincipalAttoRep: 40n * unit })
	const { hook, transport } = await setup(snapshot)
	transport.setRead('reportAuthorization', [3n * unit, 2n])
	await act(async () => {
		hook.state().setReportInput('7')
	})
	await act(async () => {
		await new Promise(resolve => setTimeout(resolve, 20))
	})
	await act(async () => {
		await new Promise(resolve => setTimeout(resolve, 20))
	})
	expect(hook.state().commitmentAmount).toBe('10.58201058201058201')
	expect(hook.state().authorizeReason).toBeUndefined()
	expect(transport.reads.filter(read => read.name === 'reportAuthorization')).toHaveLength(2)
})
test('funded authorization proofs cover existing demand when it exceeds proposed nominal capacity', async () => {
	const snapshot = capitalSnapshot({ demandAttoEth: 100n * unit })
	const { hook, transport } = await setup(snapshot)
	transport.setRead('reportAuthorization', [2n * unit, 2n])
	await act(async () => {
		hook.state().setCommitmentAmount('10')
		hook.state().setReportInput('7')
	})
	await act(async () => {
		await new Promise(resolve => setTimeout(resolve, 20))
	})
	expect(transport.reads.filter(read => read.name === 'reportAuthorization').at(-1)?.args).toEqual([7n, 100n * unit])
})

test('presentation-only balances retain position context without authorizing a write', async () => {
	const snapshot = capitalSnapshot()
	const transport = capitalClient(snapshot)
	transport.install()
	const requests: PortfolioTransaction[] = []
	const hook = await renderHookWithProps(
		() =>
			usePortfolioAggregate(
				{ snapshot: undefined, presentationSnapshot: snapshot, loading: false, error: undefined, refresh: async () => undefined },
				{
					ownerReason: undefined,
					runPortfolioAction: async (_action, _title, build) => {
						requests.push(await build())
					},
				},
				owner,
			),
		{},
	)
	lifecycle.trackRendered(hook)
	await act(() => hook.state().setReportInput('7'))
	expect(transport.reads.some(read => read.name === 'reportAuthorization')).toBe(false)
	expect(hook.state().showingPreviousSnapshot).toBe(true)
	expect(hook.state().livePositions).toEqual(snapshot.positions)
	expect(hook.state().claimReason).toBe('Account refresh pending.')
	await expect(hook.state().claim()).rejects.toThrow('Account refresh pending.')
	expect(requests).toHaveLength(0)
})
