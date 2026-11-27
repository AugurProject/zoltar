import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { decodeFunctionData, formatEther, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { useSecurityPoolAggregate } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolAggregate.js'
import type { SecurityPoolTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPool.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { auctionCapitalSnapshot, capitalSnapshot, owner, capital, unit } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const abi = parseAbi([
	'function approve(address spender,uint256 amount)',
	'function depositFor(address owner,uint256 amount)',
	'function depositPrincipal(address ledger,uint256 amount,uint256 targetHealthFactorBps)',
	'function withdrawPrincipal(uint256 amount,address recipient)',
	'function setCommitment(uint256 commitment)',
	'function setCommitmentWithReport(uint256 reportId,uint256 commitment)',
	'function setHealthTarget(uint256 targetHealthFactorBps)',
	'function depositAndSetHealthTarget(uint256 amount,uint256 targetHealthFactorBps)',
	'function claimEarnings(address recipient)',
	'function serveRetirement(uint96 id)',
])
async function setup(snapshot = capitalSnapshot()) {
	const transport = capitalClient(snapshot)
	transport.install()
	const requests: SecurityPoolTransaction[] = []
	const actions = {
		ownerReason: undefined,
		runSecurityPoolAction: async (_action: string, _title: string, build: () => SecurityPoolTransaction | Promise<SecurityPoolTransaction>) => {
			requests.push(await build())
		},
	}
	const hook = await renderHookWithProps((props: { snapshot: typeof snapshot | undefined; account: typeof owner | undefined }) => useSecurityPoolAggregate({ snapshot: props.snapshot, loading: props.snapshot === undefined, error: undefined, refresh: async () => undefined }, actions, props.account), {
		snapshot,
		account: owner,
	})
	lifecycle.trackRendered(hook)
	return { hook, requests, transport }
}

/** Lets the debounced report authorization quote settle. */
async function waitForReportQuote() {
	await act(async () => {
		await new Promise(resolve => setTimeout(resolve, 20))
	})
}

/** Enters a commitment and report price together, then waits for the report authorization quote. */
async function enterReportCommitment(hook: Awaited<ReturnType<typeof setup>>['hook'], commitmentAmount: string, reportPrice: string) {
	await act(async () => {
		hook.state().setCommitmentAmount(commitmentAmount)
		hook.state().setReportInput(reportPrice)
	})
	await waitForReportQuote()
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
	expect(hook.state().serveReason).toBe('No reduction in queue.')
})
test('authorizing backed capacity sends zero ETH without a separate funding action', async () => {
	const { hook, requests } = await setup(capitalSnapshot({ walletAttoEth: 0n }))
	await act(() => hook.state().setCommitmentAmount('11'))
	expect(hook.state().authorizeReason).toBeUndefined()
	expect(hook.state()).not.toHaveProperty('fundReserve')
	await act(() => hook.state().authorize())
	const request = requests[0]
	if (request === undefined) throw new Error('Missing authorization request')
	expect(request.value).toBe(0n)
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'setCommitment', args: [11n * unit] })
	await request.validateBeforeSubmit?.()
	expect(requests).toHaveLength(1)
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
test('a pending retirement locks the commitment: no cancel, no new request and no raise', async () => {
	const snapshot = capitalSnapshot()
	const retiring = { ...snapshot, positions: snapshot.positions.map(position => ({ ...position, batch: 1n, remainingCommitment: 5n * unit })) }
	const { hook } = await setup(retiring)
	expect(Object.keys(hook.state().positionReasons(1n))).toEqual(['retire'])
	expect('cancelRetirement' in hook.state()).toBe(false)
	expect(hook.state().positionReasons(1n).retire).toBe('A commitment reduction is already in queue.')
	await act(() => hook.state().setCommitmentAmount('11'))
	expect(hook.state().authorizeReason).toBe('This commitment is locked until its reduction clears.')
})
test('commitment starts at its saved amount, and lowering a target never sends authorization', async () => {
	const { hook, requests } = await setup()
	expect(hook.state().commitmentAmount).toBe('10')
	expect(hook.state().targetCapacity).toBe(11_904_761_904_761_904_761n)
	await act(() => hook.state().setHealthPercent('100'))
	expect(hook.state().commitmentAmount).toBe('10')
	await act(() => hook.state().useTargetCapacity())
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
	expect(hook.state().targetShortfall).toBe((3n * unit) / 2n)
	expect(hook.state().healthDepositAmount).toBe('')
	await act(() => hook.state().setHealthDepositAmount('1.5'))
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
	transport.setSnapshot({ ...funded, ownerPrincipalAttoRep: 32n * unit, positions: funded.positions.map(position => ({ ...position, rep: 32n * unit })), ownerAccount: { ...funded.ownerAccount, targetHealthFactorBps: 13_000n } })
	await request.validateBeforeSubmit?.()
	expect(request.readReviewRows?.()).toEqual([
		{ label: 'Your REP deposited', value: '32 → 33.5 REP' },
		{ label: 'Health target', value: '130% → 150%' },
	])
	transport.setSnapshot({ ...funded, allowanceAttoRep: unit })
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Approve REP')
	transport.setSnapshot({ ...funded, priceValid: false })
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('price')
})
test('target-sized retirement sends a fixed residual without silently saving an unfunded target', async () => {
	const { hook, requests } = await setup()
	await act(() => hook.state().setHealthPercent('200'))
	expect(hook.state().healthReason).toContain('REP')
	await act(() => hook.state().useTargetCapacity())
	expect(hook.state().commitmentAmount).toBe('7.142857142857142857')
	await act(() => hook.state().retire(1n))
	expect(requests).toHaveLength(1)
	const request = requests[0]
	if (request === undefined) throw new Error('Missing partial retirement request')
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'setCommitment', args: [7_142_857_142_857_142_857n] })
	expect(request.reviewDescription).toContain('saved health target stays unchanged')
	expect(request.reviewDescription).toContain('change or cancel the queued reduction')
	expect(request.reviewDescription).toContain('Your full current commitment stays active and can be liquidated until the reduction is released.')
	expect(request.reviewDescription).toContain('Reducing lowers your share of future fees.')
	await request.validateBeforeSubmit?.()
	expect(request.readReviewRows?.()).toEqual([{ label: 'Commitment when reduction completes', value: '10 → 7.142857142857142857 WETH' }])
})
function underwaterSnapshot() {
	const snapshot = capitalSnapshot()
	return { ...snapshot, liquidationPrice: 4n * unit, positions: snapshot.positions.map(position => ({ ...position, maxHealthyPrice: 2n * unit })) }
}
test('the retirement review omits the immediate cure for a covered position', async () => {
	const { hook, requests } = await setup()
	await act(() => hook.state().setCommitmentAmount('0'))
	await act(() => hook.state().retire(1n))
	expect(requests[0]?.reviewDescription).not.toContain('at once')
	expect(requests[0]?.reviewDescription).toContain('The reduction waits for free capacity')
})
test('the retirement review states the immediate cure for a position underwater at a fresh price', async () => {
	const { hook, requests } = await setup(underwaterSnapshot())
	await act(() => hook.state().setCommitmentAmount('0'))
	await act(() => hook.state().retire(1n))
	// 30 REP at a 10,500 bps multiplier and a liquidation price of 4 backs 7.142857… WETH, shown rounded down.
	expect(requests[0]?.reviewDescription).toContain('Your REP covers only 7.1428 WETH at the current price. The uncovered part can be removed at once if there is enough free capacity. The rest waits in queue.')
})
test.each(['0', '5'])('the retirement review queues target %s when the uncovered deficit is below the minimum cure', async remaining => {
	const snapshot = underwaterSnapshot()
	const { hook, requests } = await setup({ ...snapshot, economics: { ...snapshot.economics, minimumCommitmentAttoEth: 3n * unit } })
	await act(() => {
		hook.state().setCommitmentAmount(remaining)
	})
	await act(() => hook.state().retire(1n))
	expect(requests[0]?.reviewDescription).not.toContain('at once')
	expect(requests[0]?.reviewDescription).toContain('The reduction waits for free capacity')
})
test('the retirement review states six-decimal collateral amounts in collateral units', async () => {
	const usdc = 10n ** 6n
	const snapshot = capitalSnapshot()
	const underwaterUsdc: ReturnType<typeof capitalSnapshot> = {
		...snapshot,
		collateral: { ...snapshot.collateral, symbol: 'USDC', decimals: 6 },
		economics: { ...snapshot.economics, minimumCommitmentAttoEth: usdc },
		// A price of 4 × 10^30 makes 30 REP at a 10,500 bps multiplier cover 7.142857 USDC.
		liquidationPrice: 4n * 10n ** 30n,
		positions: snapshot.positions.map(position => ({ ...position, commitment: 10n * usdc, maxHealthyPrice: 2n * 10n ** 30n })),
	}
	const { hook, requests } = await setup(underwaterUsdc)
	await act(() => hook.state().setCommitmentAmount('2.5'))
	await act(() => hook.state().retire(1n))
	const request = requests[0]
	if (request === undefined) throw new Error('Missing reduction request')
	await request.validateBeforeSubmit?.()
	expect(request.readReviewRows?.()).toEqual([{ label: 'Commitment when reduction completes', value: '10 → 2.5 USDC' }])
	expect(request.reviewDescription).toContain('Your REP covers only 7.1428 USDC at the current price.')
})
test('the retirement review claims no queued rest when the kept commitment is at least the covered amount', async () => {
	const { hook, requests } = await setup(underwaterSnapshot())
	const position = underwaterSnapshot().positions[0]
	if (position === undefined) throw new Error('Missing underwater position')
	await act(() => hook.state().setCommitmentAmount(formatEther(position.commitment - unit)))
	await act(() => hook.state().retire(1n))
	expect(requests[0]?.reviewDescription).toContain('The reduction can happen at once if there is enough free capacity. Any remainder goes in queue.')
	expect(requests[0]?.reviewDescription).not.toContain('The rest waits in queue.')
})
test('the retirement review omits the immediate cure at a stale price', async () => {
	const { hook, requests } = await setup({ ...underwaterSnapshot(), priceValid: false })
	await act(() => hook.state().setCommitmentAmount('0'))
	await act(() => hook.state().retire(1n))
	expect(requests[0]?.reviewDescription).not.toContain('at once')
})
test('target sizing rounds a small reduction up to a meaningful retirement unit', async () => {
	const { hook } = await setup()
	await act(() => hook.state().setHealthPercent('150'))
	await act(() => hook.state().useTargetCapacity())
	expect(hook.state().commitmentAmount).toBe('9')
	expect(hook.state().positionReasons(1n).retire).toBeUndefined()
})
test('idle REP sizes a commitment but cannot satisfy a live health raise', async () => {
	const base = capitalSnapshot()
	const snapshot = { ...base, ownerPrincipalAttoRep: 50n * unit, ownerAccount: { ...base.ownerAccount, freeAttoRep: 20n * unit } }
	const { hook } = await setup(snapshot)
	await act(() => hook.state().setHealthPercent('200'))
	expect(hook.state().targetCapacity).toBe(11_904_761_904_761_904_761n)
	expect(hook.state().healthReason).toContain('REP')
	expect(hook.state().healthDepositAmount).toBe('')
	expect(hook.state().targetShortfall).toBe(12n * unit)
	await act(() => hook.state().useTargetCapacity())
	expect(hook.state().commitmentAmount).toBe('11.904761904761904761')
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
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'setCommitment', args: [10n * unit] })
	await request.validateBeforeSubmit?.()
	transport.setSnapshot(capitalSnapshot({ ownerAccount: { ...capitalSnapshot().ownerAccount, targetHealthFactorBps: 15_000n } }))
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('health target changed')
	transport.setSnapshot(capitalSnapshot({ ownerPrincipalAttoRep: 31n * unit }))
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('pledged REP changed')
	const largerCommitment = capitalSnapshot({ ownerCommitmentAttoEth: 12n * unit })
	transport.setSnapshot({ ...largerCommitment, positions: largerCommitment.positions.map(position => ({ ...position, commitment: 12n * unit })) })
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Queue a reduction to lower an existing commitment.')
})
test('custom admission blocks new underwriting while keeping existing owners exits available', async () => {
	const snapshot = capitalSnapshot()
	const { hook } = await setup({ ...snapshot, admission: { address: snapshot.questionAdmissionPolicy, mode: 'custom' } })
	await act(() => {
		hook.state().setDepositAmount('1')
		hook.state().setCommitmentAmount('10')
		hook.state().setWithdrawalAmount('1')
	})
	expect(hook.state().fundingReason).toContain('These question rules are unsupported.')
	expect(hook.state().authorizeReason).toContain('These question rules are unsupported.')
	expect(hook.state().withdrawReason).toBeUndefined()
	expect(hook.state().claimReason).toBeUndefined()
})
test('single owner position retains its retirement cohort and account changes clear drafts', async () => {
	const { hook, requests } = await setup()
	await act(() => hook.state().setCommitmentAmount('0'))
	expect(hook.state().positionReasons(1n).retire).toBeUndefined()
	await act(() => hook.state().retire(1n))
	const request = requests[0]
	if (request === undefined) throw new Error('Missing retirement')
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'setCommitment', args: [0n] })
	await act(() => hook.state().setDepositAmount('5'))
	await hook.setProps({ snapshot: capitalSnapshot({ universeId: 2n }) })
	expect(hook.state().depositAmount).toBe('')
})

test('approval refresh preserves health and commitment drafts until the concrete account or saved target changes', async () => {
	const { hook } = await setup()
	await act(() => {
		hook.state().setHealthPercent('150')
		hook.state().setHealthDepositAmount('7')
		hook.state().setCommitmentAmount('5')
	})
	await hook.setProps({ snapshot: undefined })
	await hook.setProps({ snapshot: capitalSnapshot({ allowanceAttoRep: 7n * unit }) })
	expect(hook.state().healthPercent).toBe('150')
	expect(hook.state().healthDepositAmount).toBe('7')
	expect(hook.state().commitmentAmount).toBe('5')
	await act(() => hook.state().setHealthPercent('200'))
	await hook.setProps({ snapshot: capitalSnapshot({ ownerAccount: { ...capitalSnapshot().ownerAccount, targetHealthFactorBps: 15_000n } }) })
	expect(hook.state().healthPercent).toBe('150')
	await hook.setProps({ snapshot: undefined })
	await hook.setProps({ snapshot: capitalSnapshot({ chainId: 2 }) })
	expect(hook.state().healthPercent).toBe('120')
	expect(hook.state().healthDepositAmount).toBe('')
	expect(hook.state().commitmentAmount).toBe('10')
})

test('retirement service stays disabled while the owner request lacks capacity', async () => {
	const base = capitalSnapshot()
	const snapshot = {
		...base,
		demandAttoEth: base.healthyCommitmentAttoEth,
		positions: base.positions.map(position => ({
			...position,
			batch: 1n,
			remainingCommitment: 5n * unit,
			retirementPreview: { status: 'insufficient-spare' as const, effectiveCurrentBatch: 1n, healthyCommitment: base.healthyCommitmentAttoEth, spareCommitment: 0n, queuedAheadCommitment: 0n, commitmentReduction: 5n * unit, releasedRep: 0n },
		})),
	}
	const { hook, requests } = await setup(snapshot)
	expect(hook.state().serveReason).toBe('Waiting for free capacity')
	expect(() => act(() => hook.state().serve())).toThrow(hook.state().serveReason)
	expect(requests).toHaveLength(0)
})

test('retirement service without an owner request cannot process other owners', async () => {
	const { hook, requests } = await setup()
	expect(hook.state().serveReason).toBe('No reduction in queue.')
	expect(() => act(() => hook.state().serve())).toThrow(hook.state().serveReason)
	expect(requests).toHaveLength(0)
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
	expect(request.readReviewRows?.()).toEqual([{ label: 'Your commitment', value: '10 → 5 WETH' }])
	transport.setSnapshot({ ...snapshot, positions: snapshot.positions.map(position => ({ ...position, commitment: 8n * unit, retirementPreview: { ...preview, commitmentReduction: 3n * unit } })) })
	await request.validateBeforeSubmit?.()
	expect(request.readReviewRows?.()).toEqual([{ label: 'Your commitment', value: '8 → 5 WETH' }])
	transport.setSnapshot({ ...snapshot, demandAttoEth: 20n * unit, positions: snapshot.positions.map(position => ({ ...position, retirementPreview: { ...preview, status: 'insufficient-spare', spareCommitment: 0n } })) })
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Free capacity changed')
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

test('a selected funded report quotes collateral, authorizes explicitly, and is rechecked before sending', async () => {
	const snapshot = capitalSnapshot({ oracleExposureLimitAttoEth: 1n, ownerPrincipalAttoRep: 40n * unit })
	const { hook, requests, transport } = await setup(snapshot)
	transport.setRead('reportAuthorization', [3n * unit, 2n])
	await enterReportCommitment(hook, '10', '7')
	expect(hook.state().authorizeReason).toBeUndefined()
	expect(hook.state().requiredCollateral).toBe(37_800_000_000_000_000_000n)
	await act(() => hook.state().authorize())
	const request = requests[0]
	if (request === undefined) throw new Error('Missing report authorization')
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'setCommitmentWithReport', args: [7n, 10n * unit] })
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
	await waitForReportQuote()
	expect(hook.state().commitmentAmount).toBe('10')
	await act(() => hook.state().useTargetCapacity())
	await waitForReportQuote()
	expect(hook.state().commitmentAmount).toBe('10.58201058201058201')
	expect(hook.state().authorizeReason).toBeUndefined()
	expect(transport.reads.filter(read => read.name === 'reportAuthorization')).toHaveLength(2)
})
test('funded authorization proofs cover existing demand when it exceeds proposed nominal capacity', async () => {
	const snapshot = capitalSnapshot({ demandAttoEth: 100n * unit })
	const { hook, transport } = await setup(snapshot)
	transport.setRead('reportAuthorization', [2n * unit, 2n])
	await enterReportCommitment(hook, '10', '7')
	expect(transport.reads.filter(read => read.name === 'reportAuthorization').at(-1)?.args).toEqual([7n, 100n * unit])
})

test('presentation-only balances retain position context without authorizing a write', async () => {
	const snapshot = capitalSnapshot()
	const transport = capitalClient(snapshot)
	transport.install()
	const requests: SecurityPoolTransaction[] = []
	const hook = await renderHookWithProps(
		() =>
			useSecurityPoolAggregate(
				{ snapshot: undefined, presentationSnapshot: snapshot, loading: false, error: undefined, refresh: async () => undefined },
				{
					ownerReason: undefined,
					runSecurityPoolAction: async (_action, _title, build) => {
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
	expect(hook.state().claimReason).toBe('Position refresh pending.')
	await expect(hook.state().claim()).rejects.toThrow('Position refresh pending.')
	expect(requests).toHaveLength(0)
})

test.each([true, false])('authenticated Capital remains actionable during or after a failed refresh (loading: %s)', async loading => {
	const hook = await renderHookWithProps(() => useSecurityPoolAggregate({ snapshot: capitalSnapshot(), loading, error: loading ? undefined : 'RPC unavailable', refresh: async () => undefined }, { ownerReason: undefined, runSecurityPoolAction: async () => undefined }, owner), {})
	lifecycle.trackRendered(hook)
	expect(hook.state().claimReason).toBeUndefined()
})

test.each([true, false])('#1448: liquidation blocks REP top-ups and combined health deposits at a fresh or stale price (%s)', async priceValid => {
	const base = capitalSnapshot()
	const snapshot = capitalSnapshot({ priceValid, allowanceAttoRep: 100n * unit, positions: base.positions.map(position => ({ ...position, maxHealthyPrice: unit, liquidationStarted: 1n })) })
	const { hook, requests } = await setup(snapshot)
	await act(() => {
		hook.state().setDepositAmount('5')
		hook.state().setHealthDepositAmount('5')
	})
	expect(hook.state().fundingReason).toContain('liquidating')
	expect(hook.state().depositReason).toContain('liquidating')
	expect(hook.state().healthDepositReason).toContain('liquidating')
	await expect(hook.state().deposit()).rejects.toThrow('liquidating')
	await expect(hook.state().depositAndSetHealth()).rejects.toThrow('liquidating')
	expect(requests).toEqual([])
})

test('#1448: a position that enters liquidation during review blocks an already planned REP deposit', async () => {
	const snapshot = capitalSnapshot({ allowanceAttoRep: 100n * unit })
	const { hook, requests, transport } = await setup(snapshot)
	await act(() => hook.state().setDepositAmount('5'))
	await act(() => hook.state().deposit())
	const request = requests[0]
	if (request?.validateBeforeSubmit === undefined) throw new Error('Deposit preflight missing')
	transport.setSnapshot({ ...snapshot, positions: snapshot.positions.map(position => ({ ...position, maxHealthyPrice: unit, liquidationStarted: 1n })) })
	await expect(request.validateBeforeSubmit()).rejects.toThrow('liquidating')
})

test('re-submits the saved pending target while keeping other retirement values locked', async () => {
	const snapshot = capitalSnapshot()
	const pending = { ...snapshot, positions: snapshot.positions.map(position => ({ ...position, batch: 1n, remainingCommitment: 5n * unit })) }
	const { hook, requests } = await setup(pending)
	expect(hook.state().positionReasons(1n, 5n * unit).retire).toBeUndefined()
	expect(hook.state().positionReasons(1n, 4n * unit).retire).toBe('A commitment reduction is already in queue.')
	await act(async () => {
		await hook.state().retire(1n, 5n * unit)
	})
	const request = requests[0]
	if (request === undefined) throw new Error('Missing repeated retirement request')
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'setCommitment', args: [5n * unit] })
})

test('#1677 another connected signer can serve a selected owners ready retirement', async () => {
	const base = capitalSnapshot()
	const snapshot = {
		...base,
		positions: base.positions.map(position => ({ ...position, batch: 1n, remainingCommitment: 5n * unit, retirementPreview: { status: 'ready' as const, effectiveCurrentBatch: 1n, healthyCommitment: 20n * unit, spareCommitment: 10n * unit, queuedAheadCommitment: 0n, commitmentReduction: 5n * unit, releasedRep: 0n } })),
	}
	const { hook, requests } = await setup(snapshot)
	await hook.setProps({ account: '0x00000000000000000000000000000000000000ff' })
	expect(hook.state().serveReason).toBeUndefined()
	await act(() => hook.state().serve())
	const request = requests[0]
	if (request === undefined) throw new Error('Missing service call')
	expect(request.account?.toLowerCase()).toBe('0x00000000000000000000000000000000000000ff')
	expect(request.to).toBe(capital)
	expect(request.reviewDescription).toContain(snapshot.owner)
	await request.validateBeforeSubmit?.()
	expect(request.readReviewRows?.().map(row => row.label)).toEqual(['Position commitment'])
})
