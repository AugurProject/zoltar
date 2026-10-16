import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { createPublicClient, http, getAddress, zeroHash, zeroAddress, decodeFunctionData, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createMockReadClient, createBlockWithTimestamp } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { usePortfolioAggregate } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioAggregate.js'
import { PortfolioAggregatePanel } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfolioAggregatePanel.js'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { renderHookWithProps } from '../../support/renderHook.js'

const owner = getAddress('0x0000000000000000000000000000000000000011')
const portfolio = getAddress('0x0000000000000000000000000000000000000033')
const pool = getAddress('0x0000000000000000000000000000000000000044')
const token = getAddress('0x0000000000000000000000000000000000000055')
const unit = 10n ** 18n
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })

async function renderAggregate(
	options: {
		beforeQuote?: (questionId: bigint) => Promise<void>
		withoutSelection?: boolean
		questionEndTime?: bigint
		resolved?: boolean
		systemState?: number
		forkTime?: bigint
		account?: typeof owner
		reusable?: boolean
		positionCount?: bigint
		questionCount?: bigint
		intervalCount?: bigint
		recoveryComplete?: boolean
		allPositionsOwned?: boolean
	} = {},
) {
	let allowance = 0n
	let fee = 10n ** 15n
	let wallet = 100n * unit
	let walletEth = 100n * unit
	let forkTime = options.forkTime ?? 0n
	let reusable = options.reusable ?? true
	let claimShares = 10n * unit
	let recoveryComplete = options.recoveryComplete ?? false
	let recoveredRep = 3n * unit
	let recoveredEth = unit
	let intervalsActive = true
	const account = options.account ?? owner
	const requests: PortfolioTransaction[] = []
	const reads: { name: string; args: readonly unknown[] | undefined }[] = []
	const client = createPublicClient({ transport: http('https://example.test') }).extend(() => ({
		getChainId: async () => 1,
		getBalance: async () => walletEth,
		getBlock: async () => ({ ...createBlockWithTimestamp(1000n), number: 1n, hash: zeroHash }),
		...createMockReadClient(async request => {
			reads.push({ name: request.functionName, args: request.args })
			switch (request.functionName) {
				case 'priceFeed':
				case 'configCoordinator':
				case 'securityPool':
				case 'zoltar':
					return token
				case 'getForkTime':
					return forkTime
				case 'recoveryLedger':
					return token
				case 'getOwnerIntervalCount':
					return options.intervalCount ?? 1n
				case 'getOwnerInterval':
					return { generation: 1n, startPosition: 1n, endPosition: 0n, shares: 10n * unit, repIndex: 0n, feeIndex: 0n, open: true, active: intervalsActive }
				case 'previewClaim':
					return [recoveredRep, recoveredEth]
				case 'processingRewards':
					return 0n
				case 'positionRecoveryComplete':
					return recoveryComplete
				case 'recoveryBounties':
					return unit / 4000n
				case 'originUniverseId':
					return 0n
				case 'repToken':
					return token
				case 'balanceOf':
					return request.address === portfolio ? 10n * unit : wallet
				case 'allowance':
					return allowance
				case 'totalSupply':
					return 100n * unit
				case 'totalAssets':
					return 200n * unit
				case 'claimableFees':
					return 0n
				case 'statoblastSecurityMultiplierBps':
					return 10_500n
				case 'lastPrice':
					return 8n * unit
				case 'questionCount':
					return options.questionCount ?? 1n
				case 'positionCount':
					return options.positionCount ?? 2n
				case 'getQuestions': {
					const [start, count] = request.args ?? []
					if (typeof start !== 'bigint' || typeof count !== 'bigint') throw new Error('Expected page bounds')
					return Array.from({ length: Number(count) }, (_, index) => start + BigInt(index) + 51n)
				}
				case 'positions':
					return [request.args?.[0], 100n * unit, 100n * unit, pool]
				case 'isReusablePosition':
					return request.args?.[0] === 1n && reusable
				case 'getOwnerPositionShares':
					return options.allPositionsOwned || request.args?.[0] === 1n ? claimShares : 0n
				case 'questionOriginIds':
					return request.args?.[0] === 99n ? zeroHash : `0x${'1'.repeat(64)}`
				case 'getPool':
					return pool
				case 'questionId':
					return 51n
				case 'universeId':
					return 0n
				case 'questionData':
					return owner
				case 'openOraclePriceCoordinator':
					return owner
				case 'getQuestionEndDate':
					return options.questionEndTime ?? 2000n
				case 'isEscalationResolved':
					return options.resolved ?? false
				case 'systemState':
					return options.systemState ?? 0
				case 'settlementCollateralAttoEth':
					return 10n * unit
				case 'totalUnderwritingLimitAttoEth':
					return 10n * unit
				case 'isPriceValid':
					return true
				case 'pendingReportId':
					return 0n
				case 'quoteMint': {
					const id = request.args?.[0]
					if (typeof id !== 'bigint') throw new Error('Expected question')
					await options.beforeQuote?.(id)
					return [2n * unit, fee, 40n * unit]
				}
				default:
					throw new Error(`Unexpected aggregate read ${request.functionName}`)
			}
		}),
	}))
	installActiveEnvironmentForTesting({ ...createFakeBackend({ accountAddress: account }), createReadClient: () => client })
	const actions: Parameters<typeof usePortfolioAggregate>[1] = {
		runPortfolioAction: async (_action, _label, build) => {
			requests.push(await build())
		},
	}
	const selection: Parameters<typeof usePortfolioAggregate>[0]['selection'] = options.withoutSelection ? undefined : { portfolio, owner, vault: zeroAddress, originUniverseId: 0n }
	const hook = lifecycle.trackRendered(await renderHookWithProps(({ selection }: { selection: Parameters<typeof usePortfolioAggregate>[0]['selection'] }) => usePortfolioAggregate({ selection, refresh: async () => undefined }, actions, account, true), { selection }))
	if (!options.withoutSelection) await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	return {
		hook,
		requests,
		reads,
		setAllowance: (value: bigint) => {
			allowance = value
		},
		setFee: (value: bigint) => {
			fee = value
		},
		setWallet: (value: bigint) => {
			wallet = value
		},
		setWalletEth: (value: bigint) => {
			walletEth = value
		},
		setForkTime: (value: bigint) => {
			forkTime = value
		},
		setReusable: (value: boolean) => {
			reusable = value
		},
		setRecoveryComplete: (value: boolean) => {
			recoveryComplete = value
		},
		setRecovered: (rep: bigint, eth: bigint) => {
			recoveredRep = rep
			recoveredEth = eth
		},
		setIntervalsActive: (value: boolean) => {
			intervalsActive = value
		},
		setClaimShares: (value: bigint) => {
			claimShares = value
		},
	}
}

test('a connected wallet without a selected portfolio is told to choose one before owner authorization', async () => {
	const { hook, reads } = await renderAggregate({ withoutSelection: true })
	for (const reason of [hook.state().fundingReason, hook.state().depositReason, hook.state().withdrawalReason, hook.state().collectReason, hook.state().mintReason, hook.state().claimReason]) expect(reason).toBe('Open a portfolio first')
	expect(reads).toHaveLength(0)
})

test('approval refresh preserves fund drafts while a changed portfolio clears them', async () => {
	const { hook } = await renderAggregate()
	await act(() => {
		hook.state().setDepositAmount('10')
		hook.state().setDepositMinimum('4')
		hook.state().setMaximumFee('0.5')
		hook.state().setWithdrawalShares('2')
	})
	await hook.setProps({ selection: undefined })
	await hook.setProps({ selection: { portfolio, owner, vault: zeroAddress, originUniverseId: 0n } })
	await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	expect(hook.state()).toMatchObject({ depositAmount: '10', depositMinimum: '4', maximumFee: '0.5', withdrawalShares: '2' })
	await hook.setProps({ selection: { portfolio: pool, owner, vault: zeroAddress, originUniverseId: 0n } })
	expect(hook.state()).toMatchObject({ depositAmount: '', depositMinimum: '', maximumFee: '', withdrawalShares: '' })
})

test.each([
	{ label: 'ended', questionEndTime: 999n, reason: 'has ended' },
	{ label: 'resolved', resolved: true, reason: 'not open' },
	{ label: 'inactive', systemState: 1, reason: 'not open' },
	{ label: 'forked-universe', forkTime: 10n, reason: 'has forked' },
])('the $label question blocks minting without requesting a quote or leaving it loading', async options => {
	const { hook, reads } = await renderAggregate(options)
	await act(() => {
		hook.state().setQuestionInput('51')
		hook.state().setMintAmount('1')
	})
	await waitFor(() => expect(hook.state().mintReason).toContain(options.reason))
	expect(reads.some(read => read.name === 'quoteMint')).toBe(false)
	expect(hook.state().quoteError).toBeUndefined()
	expect(hook.state().quoteLoading).toBe(false)
})

test('loads common holdings without a recovery vault and requires a separate pool approval before deposit', async () => {
	const { hook, requests, reads, setAllowance } = await renderAggregate()
	expect(hook.state().snapshot?.ownerAssetsAttoRep).toBe(20n * unit)
	await act(() => hook.state().setDepositAmount('10'))
	await waitFor(() => expect(hook.state().depositMinimum).toBe('5'))
	expect(hook.state().depositReason).toContain('Approve REP')
	await act(async () => await hook.state().approve(12n * unit))
	expect(requests).toHaveLength(1)
	const approval = requests[0]
	if (approval === undefined) throw new Error('Expected approval')
	expect(approval.to).toBe(token)
	expect(decodeFunctionData({ abi: parseAbi(['function approve(address,uint256)']), data: approval.data }).args).toEqual([portfolio, 12n * unit])
	setAllowance(12n * unit)
	await act(async () => await hook.state().refresh())
	expect(requests).toHaveLength(1)
	expect(hook.state().depositReason).toBeUndefined()
	await act(async () => await hook.state().deposit())
	expect(requests).toHaveLength(2)
	const deposit = requests[1]
	if (deposit === undefined) throw new Error('Expected deposit')
	expect(decodeFunctionData({ abi: parseAbi(['function deposit(uint256,uint256)']), data: deposit.data }).args).toEqual([10n * unit, 5n * unit])
	setAllowance(0n)
	await expect(deposit.validateBeforeSubmit?.()).rejects.toThrow('Approve REP')
	expect(reads.some(read => read.name === 'automaticUnderwriting' || read.name === 'quoteAllocationForMint')).toBe(false)
})

test('minting quotes the common pool and preserves the reviewed maximum fee across later price changes', async () => {
	const { hook, requests, setFee, setWalletEth } = await renderAggregate()
	await act(() => {
		hook.state().setQuestionInput('51')
		hook.state().setMintAmount('1')
		hook.state().setMinimumShares('0.9')
	})
	await waitFor(() => expect(hook.state().mintReason).toBeUndefined())
	await act(() => hook.state().setMaximumFee('0.002'))
	await act(async () => await hook.state().mint())
	const request = requests[0]
	if (request === undefined) throw new Error('Expected mint')
	expect(decodeFunctionData({ abi: parseAbi(['function createCompleteSet(uint256,address,uint256,uint256) payable']), data: request.data }).args).toEqual([51n, owner, (9n * unit) / 10n, unit])
	expect(request.value).toBe(unit + 2n * 10n ** 15n)
	setWalletEth(unit)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Insufficient wallet ETH')
	setWalletEth(100n * unit)
	setFee(3n * 10n ** 15n)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('fee')
	expect(hook.state().maximumFee).toBe('0.002')
})

test('deposit respects the current share floor and stops when the source universe forks', async () => {
	const { hook, requests, setAllowance, setForkTime } = await renderAggregate()
	setAllowance(10n * unit)
	await act(async () => await hook.state().refresh())
	await act(() => {
		hook.state().setDepositAmount('10')
		hook.state().setDepositMinimum('6')
	})
	expect(hook.state().depositReason).toContain('exceed')
	await act(() => hook.state().setDepositMinimum('5'))
	await act(async () => await hook.state().deposit())
	const request = requests[0]
	if (request === undefined) throw new Error('Expected deposit')
	setForkTime(999n)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('forked')
	await act(async () => await hook.state().refresh())
	expect(hook.state().depositReason).toContain('forked')
})

test('an obsolete quote failure cannot overwrite a changed question and recovery stays owner-bound', async () => {
	const pending = createDeferred<void>()
	const { hook, requests } = await renderAggregate({
		beforeQuote: async () => {
			await pending.promise
			throw new Error('Old quote failed')
		},
	})
	await act(() => {
		hook.state().setQuestionInput('51')
		hook.state().setMintAmount('1')
	})
	await waitFor(() => expect(hook.state().quoteLoading).toBe(true))
	await act(() => hook.state().setQuestionInput('99'))
	await waitFor(() => expect(hook.state().mintReason).toContain('Register'))
	await act(async () => pending.resolve())
	expect(hook.state().quoteError).toBeUndefined()
	await act(async () => await hook.state().claimPosition(1n))
	const request = requests[0]
	if (request === undefined) throw new Error('Expected recovery')
	expect(decodeFunctionData({ abi: parseAbi(['function claimPosition(uint256,uint256)']), data: request.data }).args).toEqual([1n, 0n])
})

test('pool controls keep approval, deposit and mint actions visible without owner routing inputs', async () => {
	const { hook } = await renderAggregate()
	const rendered = lifecycle.trackRendered(
		await renderIntoDocument(
			<PortfolioAggregatePanel
				model={hook.state()}
				actions={{
					scope: unscopedTransaction,
					busy: undefined,
					ownerReason: undefined,
					runPortfolioAction: async () => {
						throw new Error('Unexpected fork transaction')
					},
				}}
			/>,
		),
	)
	const text = rendered.container.textContent ?? ''
	expect(text).toContain('Deposit REP and commit capacity')
	expect(text).toContain('Approve REP')
	expect(text).toContain('Mint portfolio complete sets')
	expect(text).toContain('Withdraw reserve REP')
	expect(text).toContain('Allocation positions')
	expect(text).toContain('Process recovery')
	expect(text).toContain('Recover and collect REP and fees')
	expect(text).not.toContain('Update pool accounting')
	expect(text).not.toContain('Contributing vault')
})

test('a purchase without portfolio capital explains the required backing and keeps recovery available', async () => {
	const { hook } = await renderAggregate({
		beforeQuote: async () => {
			throw new Error('No portfolio capital')
		},
	})
	await act(() => {
		hook.state().setQuestionInput('51')
		hook.state().setMintAmount('1')
	})
	await waitFor(() => expect(hook.state().quoteError).toBeDefined())
	expect(hook.state().mintReason).toBe('This portfolio needs reserve REP or reusable backing before it can sell complete sets. Deposit REP or use the question’s direct mint flow.')
	expect(hook.state().collectReason).toBeUndefined()
})

test('shared processing remains permissionless across ownership changes and rejects already completed recovery', async () => {
	const { hook, requests, setReusable, setRecoveryComplete } = await renderAggregate()
	expect(hook.state().allocations[0]).toMatchObject({ reusable: true, claimReason: undefined, rebalanceReason: undefined })
	expect(hook.state().allocations[1]?.claimReason).toContain('No unclaimed ownership')
	await act(async () => await hook.state().rebalancePosition(1n))
	const request = requests[0]
	if (request === undefined) throw new Error('Expected recovery processing')
	expect(decodeFunctionData({ abi: parseAbi(['function rebalancePosition(uint256)']), data: request.data }).args).toEqual([1n])
	expect(request.reviewDescription).toContain('all recorded allocation owners')
	setReusable(false)
	await request.validateBeforeSubmit?.()
	setRecoveryComplete(true)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Recovery complete')
	await act(async () => await hook.state().refresh())
	expect(hook.state().allocations[0]?.rebalanceReason).toBe('Recovery complete')
})

test.each([{ questionEndTime: 999n }, { forkTime: 10n }, { systemState: 1 }])('ended and forked allocations retain shared processing and owner-selected individual recovery', async options => {
	const { hook, requests } = await renderAggregate(options)
	expect(hook.state().allocations[0]?.rebalanceReason).toBeUndefined()
	expect(hook.state().allocations[0]?.claimReason).toBeUndefined()
	await act(async () => await hook.state().claimPosition(1n))
	expect(requests).toHaveLength(1)
})

test('claiming a reusable allocation remains owner-bound and rechecks an already claimed share', async () => {
	const { hook, requests, setClaimShares } = await renderAggregate()
	await act(async () => await hook.state().claimPosition(1n))
	const request = requests[0]
	if (request === undefined) throw new Error('Expected allocation claim')
	expect(decodeFunctionData({ abi: parseAbi(['function claimPosition(uint256,uint256)']), data: request.data }).args).toEqual([1n, 0n])
	expect(request.reviewDescription).toContain('other owners retain their capital and reuse')
	setClaimShares(0n)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('No unclaimed ownership')
	await act(async () => await hook.state().refresh())
	expect(hook.state().allocations[0]?.claimReason).toContain('No unclaimed ownership')
})

test('reserve withdrawal checks its idle-only minimum and preserves allocation claims', async () => {
	const { hook, requests } = await renderAggregate()
	await act(() => {
		hook.state().setWithdrawalShares('10')
		hook.state().setWithdrawalMinimum('21')
	})
	expect(hook.state().withdrawalReason).toContain('exceeds your current reserve')
	await act(() => hook.state().setWithdrawalMinimum('20'))
	await act(async () => await hook.state().withdraw())
	const request = requests[0]
	if (request === undefined) throw new Error('Expected reserve withdrawal')
	expect(decodeFunctionData({ abi: parseAbi(['function withdraw(uint256,uint256)']), data: request.data }).args).toEqual([10n * unit, 20n * unit])
	expect(request.reviewDescription).toContain('ownership of existing allocations survives')
	expect(hook.state().allocations[0]?.ownerShares).toBe(10n * unit)
})

test('outsiders process shared recovery but cannot take individual control or collect another owner’s proceeds', async () => {
	const { hook, requests, setReusable } = await renderAggregate({ account: token })
	expect(hook.state().allocations[0]?.claimReason).toContain('Only the recorded owner')
	await expect(hook.state().claimPosition(1n)).rejects.toThrow('Only the recorded owner')
	await expect(hook.state().collectRecovered()).rejects.toThrow('owner')
	setReusable(false)
	await act(async () => await hook.state().refresh())
	expect(hook.state().allocations[0]?.claimReason).toContain('Only the recorded owner')
	await act(async () => await hook.state().rebalancePosition(1n))
	const request = requests[0]
	if (request === undefined) throw new Error('Expected shared recovery')
	expect(request.account).toBe(token)
	expect(decodeFunctionData({ abi: parseAbi(['function rebalancePosition(uint256)']), data: request.data }).args).toEqual([1n])
})

test('position and registered-question pages advance independently while keeping deposit drafts', async () => {
	const { hook, reads } = await renderAggregate({ positionCount: 130n, questionCount: 130n })
	expect(hook.state().snapshot?.positions).toHaveLength(64)
	expect(hook.state().snapshot?.questions).toHaveLength(64)
	await act(() => {
		hook.state().setDepositAmount('10')
		hook.state().nextPage()
	})
	await waitFor(() => expect(hook.state().snapshot?.positionStart).toBe(64n))
	expect(hook.state().snapshot?.questionStart).toBe(0n)
	await act(() => hook.state().nextQuestionPage())
	await waitFor(() => expect(hook.state().snapshot?.questionStart).toBe(64n))
	expect(hook.state().snapshot?.positionStart).toBe(64n)
	expect(hook.state().depositAmount).toBe('10')
	expect(reads.filter(read => read.name === 'getQuestions').every(read => read.args?.[1] === 64n)).toBe(true)
})

test('one collection covers a personal interval across many questions and revalidates retired history', async () => {
	const { hook, requests, setIntervalsActive } = await renderAggregate({ positionCount: 5000n })
	await act(async () => await hook.state().collectRecovered())
	const request = requests[0]
	if (request === undefined) throw new Error('Expected combined collection')
	expect(decodeFunctionData({ abi: parseAbi(['function claimRecovered(uint256[],uint256[])']), data: request.data }).args).toEqual([[0n], []])
	expect(request.account).toBe(owner)
	expect(request.reviewDescription).toContain('3 REP and 1 ETH')
	setIntervalsActive(false)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('ownership history changed')
})

test('recovery history paging is independent and collection includes only the displayed active intervals', async () => {
	const { hook, requests } = await renderAggregate({ positionCount: 130n, questionCount: 130n, intervalCount: 130n })
	await act(() => hook.state().nextIntervalPage())
	await waitFor(() => expect(hook.state().snapshot?.intervalStart).toBe(64n))
	expect(hook.state().snapshot?.positionStart).toBe(0n)
	expect(hook.state().snapshot?.questionStart).toBe(0n)
	await act(async () => await hook.state().collectRecovered())
	const request = requests[0]
	if (request === undefined) throw new Error('Expected paged collection')
	expect(decodeFunctionData({ abi: parseAbi(['function claimRecovered(uint256[],uint256[])']), data: request.data }).args).toEqual([Array.from({ length: 64 }, (_, index) => BigInt(index) + 64n), []])
	expect(request.reviewDescription).toContain('subtotal covers the selected ownership history page')
	const rendered = lifecycle.trackRendered(
		await renderIntoDocument(
			<PortfolioAggregatePanel
				model={hook.state()}
				actions={{
					scope: unscopedTransaction,
					busy: undefined,
					ownerReason: undefined,
					runPortfolioAction: async () => {
						throw new Error('Unexpected fork transaction')
					},
				}}
			/>,
		),
	)
	expect(rendered.container.textContent).toContain('Other pages may have additional proceeds')
	expect(rendered.container.textContent).toContain('Released REP subtotal')
	expect(rendered.container.textContent).toContain('Fees and rewards subtotal ETH')
})

test('combined collection stays visible and disabled when no proceeds remain', async () => {
	const { hook, setRecovered } = await renderAggregate()
	setRecovered(0n, 0n)
	await act(async () => await hook.state().refresh())
	expect(hook.state().collectReason).toContain('No released proceeds')
	await expect(hook.state().collectRecovered()).rejects.toThrow('No released proceeds')
	const rendered = lifecycle.trackRendered(
		await renderIntoDocument(
			<PortfolioAggregatePanel
				model={hook.state()}
				actions={{
					scope: unscopedTransaction,
					busy: undefined,
					ownerReason: undefined,
					runPortfolioAction: async () => {
						throw new Error('Unexpected fork transaction')
					},
				}}
			/>,
		),
	)
	const button = [...rendered.container.querySelectorAll('button')].find(item => item.textContent?.includes('Recover and collect REP and fees'))
	expect(button?.disabled).toBe(true)
})

test('collection recovers finalized allocations on the current page without a prior processor transaction', async () => {
	const { hook, requests, setRecovered } = await renderAggregate({ resolved: true })
	setRecovered(0n, 0n)
	await act(async () => await hook.state().refresh())
	expect(hook.state().collectReason).toBeUndefined()
	await act(async () => await hook.state().collectRecovered())
	const request = requests[0]
	if (request === undefined) throw new Error('Expected recovery and collection')
	expect(decodeFunctionData({ abi: parseAbi(['function claimRecovered(uint256[],uint256[])']), data: request.data }).args).toEqual([[0n], [1n]])
	expect(request.reviewDescription).toContain('1 finalized allocation')
})

test('owners can reduce recovery work in the same collection action and collect credits alone', async () => {
	const { hook, requests } = await renderAggregate({ resolved: true, positionCount: 20n, allPositionsOwned: true })
	expect(hook.state().recoveryPositionCount).toBe(8)
	await act(() => hook.state().setRecoveryBatchSize('1'))
	await act(() => hook.state().collectRecovered())
	const first = requests.at(-1)
	if (first === undefined) throw new Error('Expected recovery transaction')
	expect(decodeFunctionData({ abi: parseAbi(['function claimRecovered(uint256[],uint256[])']), data: first.data }).args).toEqual([[0n], [1n]])
	await act(() => hook.state().setRecoveryBatchSize('0'))
	await act(() => hook.state().collectRecovered())
	const credits = requests.at(-1)
	if (credits === undefined) throw new Error('Expected collection transaction')
	expect(decodeFunctionData({ abi: parseAbi(['function claimRecovered(uint256[],uint256[])']), data: credits.data }).args).toEqual([[0n], []])
	await act(() => hook.state().setRecoveryBatchSize('-1'))
	expect(hook.state().collectReason).toContain('whole number')
})
