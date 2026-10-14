import { expect, test } from 'bun:test'
import { render } from 'preact'
import { useSignal } from '@preact/signals'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { act } from 'preact/test-utils'
import { createPublicClient, http, getAddress, zeroHash, zeroAddress, toHex, decodeFunctionData, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createMockReadClient, createBlockWithTimestamp } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import type { PortfolioSnapshot, PortfolioPosition } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { usePortfolioAutomatic } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioAutomatic.js'
import { PortfolioMintPanel } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfolioAutomaticPanel.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { renderHookWithProps } from '../../support/renderHook.js'

const owner = getAddress('0x0000000000000000000000000000000000000011')
const vault = getAddress('0x0000000000000000000000000000000000000022')
const portfolio = getAddress('0x0000000000000000000000000000000000000033')
const pool = getAddress('0x0000000000000000000000000000000000000044')
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const position: PortfolioPosition = {
	questionId: 51n,
	universeId: 0n,
	pool,
	registered: true,
	repToken: owner,
	coordinator: owner,
	priceFeed: owner,
	pendingReportCoordinator: owner,
	backingUnits: 100n,
	backingAttoRep: 100n,
	commitmentAttoEth: 10n,
	claimableFeesAttoEth: 0n,
	openInterestAttoEth: 10n,
	badDebtAttoEth: 0n,
	disputeStakeAttoRep: 0n,
	ordinaryResidualPending: false,
	poolHeldAttoRep: 100n,
	totalBackingUnits: 100n,
	poolCommitmentAttoEth: 10n,
	settlementCollateralAttoEth: 10n,
	securityMultiplierBps: 20000n,
	minimumDepositAttoRep: 1n,
	systemState: 0n,
	resolved: false,
	questionEndTime: 2000n,
	forkTime: 0n,
	price: 10n ** 18n,
	priceValid: true,
	pendingReportId: 0n,
	settlementTime: 0n,
	queuedOperations: [],
	queuedOperationsComplete: true,
	allocationOperationsComplete: true,
}

async function renderAutomatic(
	overrides: Partial<PortfolioPosition> = {},
	withdrawal = false,
	lookup: { positions?: PortfolioPosition[]; beforeRead?: (questionId: bigint) => Promise<void>; beforeContractRead?: (functionName: string) => Promise<void>; waitForState?: boolean; quoteFee?: bigint; beforeQuote?: (questionId: bigint) => Promise<void> } = {},
) {
	let version = 3n
	let vaultEthBalance = 0n
	let enabled = true
	let residualForfeitureAllowed = false
	let reservationFeeBps = 100n
	let quotedFee = lookup.quoteFee ?? 10n ** 15n
	let captured: PortfolioTransaction | undefined
	const questionReads: { questionId: bigint; blockNumber: unknown }[] = []
	const quoteReads: { vault: string; questionId: bigint; increase: unknown; blockNumber: unknown }[] = []
	const snapshot: PortfolioSnapshot = {
		chainId: 1,
		blockNumber: 1n,
		blockHash: zeroHash,
		timestamp: 1000n,
		portfolio,
		vault,
		owner,
		originUniverseId: 0n,
		questions: [51n],
		branches: [{ universeId: 0n, repToken: owner, idleAttoRep: 100n, forkTime: 0n, positions: [{ ...position, ...overrides }] }],
		coverage: { complete: true, registryComplete: true, issues: [], scope: 'registered-and-explicit-pools' },
	}
	const client = createPublicClient({ transport: http('https://example.test') }).extend(() => ({
		getChainId: async () => 1,
		getBlock: async () => ({ ...createBlockWithTimestamp(1000n), number: 1n, hash: zeroHash }),
		...createMockReadClient(async request => {
			await lookup.beforeContractRead?.(request.functionName)
			const remote = lookup.positions?.find(position => position.pool === request.address || position.coordinator === request.address) ?? snapshot.branches[0]?.positions.find(position => position.pool === request.address || position.coordinator === request.address)
			switch (request.functionName) {
				case 'questionOriginIds': {
					const id = request.args?.[0]
					if (typeof id !== 'bigint') throw new Error('Expected a question ID')
					questionReads.push({ questionId: id, blockNumber: request.blockNumber })
					await lookup.beforeRead?.(id)
					return lookup.positions?.some(position => position.questionId === id) || snapshot.questions.includes(id) ? toHex(id, { size: 32 }) : zeroHash
				}
				case 'getPool':
					return lookup.positions?.find(position => position.questionId === request.args?.[0])?.pool ?? snapshot.branches[0]?.positions.find(position => position.questionId === request.args?.[0])?.pool ?? zeroAddress
				case 'questionId':
					return remote?.questionId
				case 'universeId':
					return remote?.universeId
				case 'questionData':
					return owner
				case 'openOraclePriceCoordinator':
					return remote?.coordinator
				case 'getQuestionEndDate':
					return lookup.positions?.find(position => position.questionId === request.args?.[0])?.questionEndTime ?? snapshot.branches[0]?.positions.find(position => position.questionId === request.args?.[0])?.questionEndTime
				case 'isEscalationResolved':
					return remote?.resolved
				case 'systemState':
					return remote?.systemState
				case 'settlementCollateralAttoEth':
					return remote?.settlementCollateralAttoEth
				case 'totalUnderwritingLimitAttoEth':
					return remote?.poolCommitmentAttoEth
				case 'isPriceValid':
					return remote?.priceValid
				case 'pendingReportId':
					return remote?.pendingReportId
				case 'quoteAllocationForMint':
					if (typeof request.args?.[0] !== 'bigint') throw new Error('Expected quote question ID')
					quoteReads.push({ vault: request.address, questionId: request.args[0], increase: request.args[1], blockNumber: request.blockNumber })
					await lookup.beforeQuote?.(request.args[0])
					return [100n * 10n ** 18n, quotedFee]
				case 'getEthBalance':
					return vaultEthBalance
				case 'automaticUnderwriting':
					return [enabled, 5n, 12000n, reservationFeeBps, 10n ** 15n]
				case 'allocationPolicyVersion':
					return version
				case 'allocationPolicyNonce':
					return 2n
				case 'withdrawalRequested':
					return withdrawal
				case 'withdrawalResidualForfeitureAllowed':
					return residualForfeitureAllowed
				case 'withdrawalRequestId':
					return 1n
				case 'maximumQuestionHorizonSeconds':
					return 30n * 86400n
				case 'allocatedQuestionCount':
					return 1n
				case 'getAllocatedQuestions':
					return [51n]
				case 'withdrawalRequestCount':
					return 0n
				case 'getWithdrawalRequests':
					return []
				case 'portfolio':
					return portfolio
				default:
					throw new Error(`Unexpected automatic read ${request.functionName}`)
			}
		}),
	}))
	installActiveEnvironmentForTesting({ ...createFakeBackend({ accountAddress: owner }), createReadClient: () => client })
	const model = { loading: false, snapshot, selection: { portfolio, vault, owner, originUniverseId: 0n }, refresh: async () => undefined, load: async () => undefined }
	const actions: Parameters<typeof usePortfolioAutomatic>[1] = {
		vaultReason: undefined,
		runPortfolioAction: async (_action, _label, build) => {
			captured = await build()
		},
	}
	const hook = lifecycle.trackRendered(
		await renderHookWithProps(() => {
			const currentSnapshot = useSignal(snapshot)
			return usePortfolioAutomatic(
				{
					...model,
					snapshot: currentSnapshot.value,
					refresh: async () => {
						currentSnapshot.value = { ...currentSnapshot.value }
					},
				},
				actions,
				owner,
			)
		}, {}),
	)
	if (lookup.waitForState !== false) await waitFor(() => expect(hook.state().state !== undefined || hook.state().readError !== undefined).toBe(true))
	return {
		hook,
		captured: () => captured,
		questionReads,
		quoteReads,
		snapshot,
		changeAuthority: () => {
			version += 1n
		},
		changeResidualConsent: () => {
			residualForfeitureAllowed = !residualForfeitureAllowed
		},
		changeVaultEth: (balance: bigint) => {
			vaultEthBalance = balance
		},
		changeQuote: (fee: bigint) => {
			quotedFee = fee
		},
		changeReservationFee: () => {
			reservationFeeBps += 1n
		},
		disableContributor: () => {
			enabled = false
		},
	}
}

test('automatic consent needs acknowledgement and rejects a changed reviewed authority before submission', async () => {
	const { hook, captured, changeAuthority } = await renderAutomatic()
	expect(hook.state().enableReason).toContain('accept')
	await act(() => {
		hook.state().setReserve('2')
		hook.state().setAcknowledged(true)
	})
	expect(hook.state().enableReason).toBeUndefined()
	await act(async () => {
		await hook.state().enable()
	})
	const request = captured()
	if (request === undefined) throw new Error('Expected consent request')
	expect(decodeFunctionData({ abi: parseAbi(['function setAutomaticUnderwriting(uint256,uint256,uint256,uint256,uint256,uint256)']), data: request.data }).args).toEqual([3n, 2n, 2n * 10n ** 18n, 12000n, 100n, 10n ** 15n])
	changeAuthority()
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('authority changed')
})

test('final withdrawal remains processable with outstanding collateral and stale price, and uses the selected native branch', async () => {
	const { hook, captured } = await renderAutomatic({ resolved: true, priceValid: false }, true)
	expect(hook.state().enableReason).toContain('Cancel')
	const position = hook.state().positions[0]
	if (position === undefined) throw new Error('Expected position')
	expect(position.processReason).toBeUndefined()
	await act(async () => {
		await position.process()
	})
	const request = captured()
	if (request === undefined) throw new Error('Expected process request')
	expect(request.account).toBe(owner)
	expect(request.to).toBe(vault)
	expect(decodeFunctionData({ abi: parseAbi(['function processWithdrawal(uint256,uint248)']), data: request.data }).args).toEqual([51n, 0n])
})

test('mint demand exposes a native price prerequisite before a transaction is attempted', async () => {
	const { hook, captured } = await renderAutomatic({ priceValid: false })
	await act(() => {
		hook.state().setQuestionId('51')
		hook.state().setMintAmount('1')
		hook.state().setMinimumShares('0.9')
	})
	expect(hook.state().mintReason).toContain('pool price')
	expect(hook.state().mintPool).toBe(pool)
	await expect(hook.state().mint()).rejects.toThrow('pool price')
	expect(captured()).toBeUndefined()
})

test('disabled contributor consent blocks a capacity-deficit mint', async () => {
	const { hook, disableContributor } = await renderAutomatic()
	disableContributor()
	await act(() => {
		hook.state().setQuestionId('51')
		hook.state().setMintAmount('1')
		hook.state().setMinimumShares('0.9')
		hook.state().setContributors(`${vault}, `)
	})
	await waitFor(() => expect(hook.state().mintReason).toContain('disabled automatic'))
})

test('loads a registered entered question outside the watchlist before minting without changing tracked positions', async () => {
	const remotePool = getAddress('0x0000000000000000000000000000000000000052')
	const { hook, captured, snapshot, questionReads } = await renderAutomatic({}, false, { positions: [{ ...position, questionId: 52n, pool: remotePool, coordinator: remotePool }] })
	await act(() => {
		hook.state().setQuestionId('52')
		hook.state().setMintAmount('1')
		hook.state().setMinimumShares('0.9')
	})
	await waitFor(() => expect(hook.state().mintReason).toBeUndefined())
	expect(hook.state().mintPool).toBe(remotePool)
	expect(questionReads).toEqual([{ questionId: 52n, blockNumber: 1n }])
	expect(snapshot.questions).toEqual([51n])
	await act(async () => await hook.state().mint())
	const request = captured()
	if (request === undefined) throw new Error('Expected mint request')
	await act(() => hook.state().setQuestionId('53'))
	expect(decodeFunctionData({ abi: parseAbi(['function createCompleteSet(uint256,(address vault,uint256 maximumCommitmentIncreaseAttoEth)[],address,uint256,uint256) payable']), data: request.data }).args?.[0]).toBe(52n)
})

test('a late question response cannot enable minting or replace the current question price prerequisite', async () => {
	const firstPool = getAddress('0x0000000000000000000000000000000000000052')
	const secondPool = getAddress('0x0000000000000000000000000000000000000053')
	let release: (() => void) | undefined
	const pending = new Promise<void>(resolve => {
		release = resolve
	})
	const { hook, captured, questionReads } = await renderAutomatic({}, false, {
		positions: [
			{ ...position, questionId: 52n, pool: firstPool, coordinator: firstPool },
			{ ...position, questionId: 53n, pool: secondPool, coordinator: secondPool, priceValid: false },
		],
		beforeRead: async id => {
			if (id === 52n) await pending
		},
	})
	await act(() => {
		hook.state().setQuestionId('52')
		hook.state().setMintAmount('1')
		hook.state().setMinimumShares('0.9')
	})
	expect(hook.state().mintQuestionLoading).toBe(true)
	await waitFor(() => expect(questionReads).toHaveLength(1))
	await act(() => hook.state().setQuestionId('53'))
	expect(hook.state().mintPool).toBeUndefined()
	expect(hook.state().mintReason).toContain('Checking question')
	await waitFor(() => expect(hook.state().mintReason).toContain('pool price'))
	await act(async () => {
		release?.()
		await pending
	})
	expect(hook.state().mintPool).toBe(secondPool)
	expect(hook.state().mintReason).toContain('pool price')
	await expect(hook.state().mint()).rejects.toThrow('pool price')
	expect(captured()).toBeUndefined()
})

test('failed question reads expose recovery and reveal the native price route before mint amounts are entered', async () => {
	const remotePool = getAddress('0x0000000000000000000000000000000000000052')
	let fail = true
	const { hook, questionReads } = await renderAutomatic({}, false, {
		positions: [{ ...position, questionId: 52n, pool: remotePool, coordinator: remotePool }],
		beforeRead: async () => {
			if (fail) throw new Error('Question RPC unavailable')
		},
	})
	await act(() => hook.state().setQuestionId('52'))
	await waitFor(() => expect(hook.state().mintQuestionError).toContain('Question RPC unavailable'))
	expect(hook.state().mintReason).toBe(hook.state().mintQuestionError)
	fail = false
	await act(() => hook.state().retryMintQuestion())
	expect(hook.state().mintQuestionError).toBeUndefined()
	expect(hook.state().mintQuestionLoading).toBe(true)
	await waitFor(() => expect(hook.state().mintPool).toBe(remotePool))
	expect(questionReads).toHaveLength(2)
	expect(hook.state().mintReason).toBeDefined()
})

test('invalid and unregistered question inputs remain blocked without changing the saved watchlist', async () => {
	const { hook, questionReads, snapshot } = await renderAutomatic()
	await act(() => hook.state().setQuestionId('not-a-question'))
	expect(hook.state().mintReason).toBe('Enter a valid question ID')
	expect(questionReads).toHaveLength(0)
	await act(() => hook.state().setQuestionId('99'))
	await waitFor(() => expect(hook.state().mintReason).toBe('Register this question before minting'))
	expect(hook.state().mintQuestionError).toBeUndefined()
	expect(snapshot.questions).toEqual([51n])
})

test('a verified snapshot position replaces a failed direct question lookup at the same block', async () => {
	const remotePool = getAddress('0x0000000000000000000000000000000000000052')
	const remotePosition = { ...position, questionId: 52n, pool: remotePool, coordinator: remotePool }
	const { hook, snapshot } = await renderAutomatic({}, false, {
		positions: [remotePosition],
		beforeRead: async () => {
			throw new Error('Question RPC unavailable')
		},
	})
	await act(() => {
		hook.state().setQuestionId('52')
		hook.state().setMintAmount('1')
		hook.state().setMinimumShares('0.9')
	})
	await waitFor(() => expect(hook.state().mintQuestionError).toContain('Question RPC unavailable'))
	const origin = snapshot.branches[0]
	if (origin === undefined) throw new Error('Expected origin branch')
	origin.positions.push(remotePosition)
	snapshot.questions.push(52n)
	await hook.setProps({})
	expect(hook.state().mintPool).toBe(remotePool)
	expect(hook.state().mintQuestionError).toBeUndefined()
	await waitFor(() => expect(hook.state().mintReason).toBeUndefined())
})

const refreshReads = [
	{ name: 'automatic authority', functionName: 'allocationPolicyVersion', error: (state: ReturnType<typeof usePortfolioAutomatic>) => state.readError },
	{ name: 'withdrawal history', functionName: 'withdrawalRequestCount', error: (state: ReturnType<typeof usePortfolioAutomatic>) => state.queueError },
	{ name: 'contributor eligibility', functionName: 'portfolio', error: (state: ReturnType<typeof usePortfolioAutomatic>) => state.mintReason },
]

async function enterMint(hook: Awaited<ReturnType<typeof renderAutomatic>>['hook']) {
	await act(() => {
		hook.state().setQuestionId('51')
		hook.state().setMintAmount('1')
		hook.state().setMinimumShares('0.9')
	})
}

for (const read of refreshReads) {
	test(`same-block refresh retries failed ${read.name} reads`, async () => {
		let fail = true
		let reads = 0
		const { hook, snapshot } = await renderAutomatic({}, false, {
			beforeContractRead: async name => {
				if (name !== read.functionName) return
				reads++
				if (fail) throw new Error('Temporary read outage')
			},
		})
		await enterMint(hook)
		await waitFor(() => expect(read.error(hook.state())).toContain('Temporary read outage'))
		const previousReads = reads
		fail = false
		await act(async () => {
			await hook.state().retry()
		})
		await waitFor(() => {
			expect(reads).toBeGreaterThan(previousReads)
			expect(hook.state().state?.version).toBe(3n)
			expect(hook.state().queue).toBeDefined()
			expect(hook.state().readError).toBeUndefined()
			expect(hook.state().queueError).toBeUndefined()
			expect(hook.state().mintReason).toBeUndefined()
			expect(hook.state().requestReason).toBeUndefined()
		})
		expect(snapshot.blockNumber).toBe(1n)
		expect(snapshot.blockHash).toBe(zeroHash)
	})

	test(`same-block refresh ignores an older ${read.name} failure after recovery`, async () => {
		const oldRead = createDeferred<void>()
		let hold = true
		let reads = 0
		const { hook } = await renderAutomatic({}, false, {
			waitForState: false,
			beforeContractRead: async name => {
				if (name !== read.functionName) return
				reads++
				if (hold) await oldRead.promise
			},
		})
		await enterMint(hook)
		await waitFor(() => expect(reads).toBeGreaterThan(0))
		const previousReads = reads
		hold = false
		await act(async () => {
			await hook.state().retry()
		})
		await waitFor(() => {
			expect(reads).toBeGreaterThan(previousReads)
			expect(hook.state().requestReason).toBeUndefined()
			expect(hook.state().queue).toBeDefined()
			expect(hook.state().mintReason).toBeUndefined()
		})
		await act(async () => {
			oldRead.reject(new Error('Obsolete request failed'))
			await oldRead.promise.catch(() => undefined)
		})
		expect(hook.state().readError).toBeUndefined()
		expect(hook.state().queueError).toBeUndefined()
		expect(hook.state().mintReason).toBeUndefined()
	})
}

test('same-block snapshot refresh retries a failed entered-question lookup', async () => {
	const remotePool = getAddress('0x0000000000000000000000000000000000000052')
	let fail = true
	const { hook, questionReads } = await renderAutomatic({}, false, {
		positions: [{ ...position, questionId: 52n, pool: remotePool, coordinator: remotePool }],
		beforeRead: async () => {
			if (fail) throw new Error('Question read outage')
		},
	})
	await enterMint(hook)
	await act(() => hook.state().setQuestionId('52'))
	await waitFor(() => expect(hook.state().mintQuestionError).toContain('Question read outage'))
	fail = false
	await act(async () => {
		await hook.state().retry()
	})
	expect(hook.state().mintQuestionLoading).toBe(true)
	expect(hook.state().mintQuestionError).toBeUndefined()
	await waitFor(() => expect(hook.state().mintReason).toBeUndefined())
	expect(questionReads).toHaveLength(2)
})

test('separate residual consent is reviewed, can be revoked, and invalidates pending withdrawal reviews', async () => {
	const { hook, captured, changeResidualConsent } = await renderAutomatic({ resolved: true, ordinaryResidualPending: true }, true)
	expect(hook.state().positions[0]?.processReason).toContain('residual')
	await act(async () => await hook.state().allowResidualForfeiture())
	const consent = captured()
	if (consent === undefined) throw new Error('Expected residual consent request')
	expect(decodeFunctionData({ abi: parseAbi(['function setWithdrawalResidualForfeiture(bool)']), data: consent.data }).args).toEqual([true])
	expect(consent.reviewDescription).toContain('permanently')
	changeResidualConsent()
	await expect(consent.validateBeforeSubmit?.()).rejects.toThrow('authority changed')
	await act(async () => await hook.state().retry())
	await waitFor(() => expect(hook.state().state?.withdrawalResidualForfeitureAllowed).toBe(true))
	expect(hook.state().positions[0]?.processReason).toBeUndefined()
	await act(async () => await hook.state().revokeResidualForfeiture())
	const revoke = captured()
	if (revoke === undefined) throw new Error('Expected residual protection request')
	expect(decodeFunctionData({ abi: parseAbi(['function setWithdrawalResidualForfeiture(bool)']), data: revoke.data }).args).toEqual([false])
})

test('owner fee edits reset acknowledgement and fee changes invalidate reviewed authority', async () => {
	const { hook, captured, changeReservationFee } = await renderAutomatic()
	await act(() => hook.state().setAcknowledged(true))
	await act(() => hook.state().setReservationFee('250'))
	expect(hook.state().acknowledged).toBe(false)
	await act(() => {
		hook.state().setMinimumAllocationFee('0.002')
		hook.state().setAcknowledged(true)
	})
	await act(async () => await hook.state().enable())
	const request = captured()
	if (request === undefined) throw new Error('Expected fee authorization request')
	expect(decodeFunctionData({ abi: parseAbi(['function setAutomaticUnderwriting(uint256,uint256,uint256,uint256,uint256,uint256)']), data: request.data }).args?.slice(-2)).toEqual([250n, 2n * 10n ** 15n])
	expect(request.reviewDescription).toContain('250 bps')
	expect(request.reviewDescription).toContain('0.002 ETH')
	changeReservationFee()
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('authority changed')
})

test('native minimum backing fees are estimated separately from collateral without overwriting an edited fee limit', async () => {
	const { hook, captured, changeQuote } = await renderAutomatic({}, false, { quoteFee: 11n * 10n ** 17n })
	await act(() => {
		hook.state().setQuestionId('51')
		hook.state().setMintAmount('0.0001')
		hook.state().setMinimumShares('0')
	})
	await waitFor(() => expect(hook.state().mintReason).toBeUndefined())
	expect(hook.state().estimatedReservationFee).toBe(11n * 10n ** 17n)
	expect(hook.state().maximumReservationFee).toBe('1.1')
	await act(async () => await hook.state().mint())
	const request = captured()
	if (request === undefined) throw new Error('Expected quoted mint request')
	expect(request.value).toBe(11n * 10n ** 17n + 10n ** 14n)
	expect(decodeFunctionData({ abi: parseAbi(['function createCompleteSet(uint256,(address vault,uint256 maximumCommitmentIncreaseAttoEth)[],address,uint256,uint256) payable']), data: request.data }).args?.[4]).toBe(10n ** 14n)
	expect(request.reviewDescription).toContain('1.1 ETH')
	await act(() => hook.state().setMaximumReservationFee('0.5'))
	changeQuote(12n * 10n ** 17n)
	await act(() => hook.state().retryReservationFee())
	await waitFor(() => expect(hook.state().estimatedReservationFee).toBe(12n * 10n ** 17n))
	expect(hook.state().maximumReservationFee).toBe('0.5')
	expect(hook.state().mintReason).toContain('below the current estimate')
	await act(() => hook.state().useEstimatedReservationFee())
	expect(hook.state().maximumReservationFee).toBe('1.2')
	expect(hook.state().mintReason).toBeUndefined()
})

test('quote failure blocks minting and exposes a retry without changing the fee limit', async () => {
	let unavailable = true
	const { hook } = await renderAutomatic({}, false, {
		beforeQuote: async () => {
			if (unavailable) throw new Error('Quote unavailable')
		},
	})
	await act(() => {
		hook.state().setQuestionId('51')
		hook.state().setMintAmount('1')
		hook.state().setMinimumShares('0')
		hook.state().setMaximumReservationFee('2')
	})
	await waitFor(() => expect(hook.state().reservationFeeError).toContain('Quote unavailable'))
	expect(hook.state().mintReason).toContain('Quote unavailable')
	await expect(hook.state().mint()).rejects.toThrow('Quote unavailable')
	unavailable = false
	await act(() => hook.state().retryReservationFee())
	await waitFor(() => expect(hook.state().mintReason).toBeUndefined())
	expect(hook.state().maximumReservationFee).toBe('2')
})

test('fee quotes route the missing commitment in contributor order and charge each used allocation', async () => {
	const secondVault = getAddress('0x0000000000000000000000000000000000000066')
	const thirdVault = getAddress('0x0000000000000000000000000000000000000077')
	const { hook, quoteReads } = await renderAutomatic({ settlementCollateralAttoEth: 15n * 10n ** 17n, poolCommitmentAttoEth: 0n })
	await act(() => {
		hook.state().setQuestionId('51')
		hook.state().setMintAmount('1')
		hook.state().setMinimumShares('0')
		hook.state().setContributors(`${vault},${secondVault},${thirdVault}`)
	})
	await waitFor(() => expect(hook.state().mintReason).toBeUndefined())
	expect(quoteReads).toEqual([
		{ vault, questionId: 51n, increase: 10n ** 18n, blockNumber: 1n },
		{ vault: secondVault, questionId: 51n, increase: 10n ** 18n, blockNumber: 1n },
		{ vault: thirdVault, questionId: 51n, increase: 5n * 10n ** 17n, blockNumber: 1n },
	])
	expect(hook.state().estimatedReservationFee).toBe(3n * 10n ** 15n)
	await act(() => hook.state().setContributors(`${vault},${vault}`))
	expect(hook.state().mintReason).toContain('unique')
})

test('an obsolete quote failure cannot overwrite the current question estimate', async () => {
	const delayed = createDeferred<void>()
	const remotePool = getAddress('0x0000000000000000000000000000000000000052')
	const { hook, quoteReads } = await renderAutomatic({}, false, {
		positions: [{ ...position, questionId: 52n, pool: remotePool, coordinator: remotePool }],
		beforeQuote: async questionId => {
			if (questionId === 51n) {
				await delayed.promise
				throw new Error('Obsolete quote failure')
			}
		},
	})
	await act(() => {
		hook.state().setQuestionId('51')
		hook.state().setMintAmount('1')
		hook.state().setMinimumShares('0')
	})
	await waitFor(() => expect(quoteReads.some(read => read.questionId === 51n)).toBe(true))
	expect(hook.state().reservationFeeLoading).toBe(true)
	await act(() => hook.state().setQuestionId('52'))
	await waitFor(() => expect(hook.state().mintReason).toBeUndefined())
	await act(async () => {
		delayed.resolve()
		await delayed.promise
	})
	expect(hook.state().reservationFeeError).toBeUndefined()
	expect(hook.state().estimatedReservationFee).toBe(10n ** 15n)
})

for (const change of ['fee quote', 'owner fees'] as const) {
	test(`a changed ${change} invalidates the reviewed mint without raising its maximum fee`, async () => {
		const { hook, captured, changeQuote, changeReservationFee } = await renderAutomatic()
		await act(() => {
			hook.state().setQuestionId('51')
			hook.state().setMintAmount('1')
			hook.state().setMinimumShares('0')
			hook.state().setMaximumReservationFee('2')
		})
		await waitFor(() => expect(hook.state().mintReason).toBeUndefined())
		await act(async () => await hook.state().mint())
		const request = captured()
		if (request === undefined) throw new Error('Expected reviewed mint')
		await request.validateBeforeSubmit?.()
		if (change === 'fee quote') changeQuote(2n * 10n ** 15n)
		else changeReservationFee()
		await expect(request.validateBeforeSubmit?.()).rejects.toThrow(change === 'fee quote' ? 'estimate changed' : 'authority changed')
		expect(request.value).toBe(3n * 10n ** 18n)
	})
}

test('owner ETH withdrawal exposes available earnings and rejects a changed reviewed balance', async () => {
	const { hook, captured, changeVaultEth } = await renderAutomatic()
	expect(hook.state().withdrawEthReason).toContain('No ETH')
	await expect(hook.state().withdrawEth()).rejects.toThrow('No ETH')
	changeVaultEth(2n * 10n ** 18n)
	await act(async () => await hook.state().retry())
	await waitFor(() => expect(hook.state().state?.ethBalanceAttoEth).toBe(2n * 10n ** 18n))
	expect(hook.state().withdrawEthReason).toBeUndefined()
	await act(async () => await hook.state().withdrawEth())
	const request = captured()
	if (request === undefined) throw new Error('Expected ETH withdrawal request')
	expect(decodeFunctionData({ abi: parseAbi(['function withdrawEth()']), data: request.data }).functionName).toBe('withdrawEth')
	expect(request.reviewDescription).toContain('2 ETH')
	expect(request.reviewDescription).toContain('remain unchanged')
	await request.validateBeforeSubmit?.()
	changeVaultEth(3n * 10n ** 18n)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('ETH balance changed')
})

test('valid mint inputs keep precise accessible quote guidance through refresh, failure and recovery', async () => {
	let pendingQuote: Promise<void> | undefined
	const { hook } = await renderAutomatic({}, false, { beforeQuote: async () => await pendingQuote })
	await act(() => {
		hook.state().setQuestionId('51')
		hook.state().setMintAmount('1')
		hook.state().setMinimumShares('0')
		hook.state().setMaximumReservationFee('2')
	})
	await waitFor(() => expect(hook.state().mintReason).toBeUndefined())
	const actions = { busy: undefined, scope: unscopedTransaction }
	const panel = lifecycle.trackRendered(await renderIntoDocument(<PortfolioMintPanel model={hook.state()} actions={actions} />))
	const updatePanel = () => act(() => render(<PortfolioMintPanel model={hook.state()} actions={actions} />, panel.container))
	const button = (label: string) => {
		const match = [...panel.container.querySelectorAll('button')].find(element => element.textContent === label)
		if (match === undefined) throw new Error(`Missing button ${label}`)
		return match
	}
	const description = (element: HTMLButtonElement) =>
		(element.getAttribute('aria-describedby') ?? '')
			.split(/\s+/)
			.map(id => document.getElementById(id)?.textContent ?? '')
			.join(' ')
	const useEstimate = button('Use estimate for fee limit')
	const mint = button('Mint portfolio complete sets')
	expect(useEstimate.disabled).toBe(false)
	expect(mint.disabled).toBe(false)
	expect(description(useEstimate)).toBe('')
	expect(description(button('Refresh fee estimate'))).toBe('')
	const stalled = createDeferred<void>()
	pendingQuote = stalled.promise
	await act(() => hook.state().retryReservationFee())
	await waitFor(() => expect(hook.state().reservationFeeLoading).toBe(true))
	await updatePanel()
	expect(button('Use estimate for fee limit')).toBe(useEstimate)
	expect(button('Mint portfolio complete sets')).toBe(mint)
	expect(useEstimate.disabled).toBe(true)
	expect(mint.disabled).toBe(true)
	expect(description(useEstimate)).toContain('Estimating')
	expect(description(useEstimate)).not.toContain('Enter valid mint details')
	await act(async () => {
		stalled.reject(new Error('Quote unavailable'))
		await stalled.promise.catch(failure => expect(failure).toBeInstanceOf(Error))
	})
	await waitFor(() => expect(hook.state().reservationFeeError).toContain('Quote unavailable'))
	await updatePanel()
	expect(description(useEstimate)).toContain('Quote unavailable')
	expect(description(useEstimate)).not.toContain('Enter valid mint details')
	expect(button('Refresh fee estimate').disabled).toBe(false)
	expect(mint.disabled).toBe(true)
	pendingQuote = undefined
	await act(() => hook.state().retryReservationFee())
	await waitFor(() => expect(hook.state().mintReason).toBeUndefined())
	await updatePanel()
	expect(useEstimate.disabled).toBe(false)
	expect(mint.disabled).toBe(false)
	expect(description(useEstimate)).toBe('')
	expect(description(button('Refresh fee estimate'))).toBe('')
	expect(hook.state().maximumReservationFee).toBe('2')
})
