/// <reference types="bun-types" />

import { waitFor } from '../../testUtils/queries'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, type Address } from '@zoltar/shared/ethereum'
import type { OpenOracleReportDetails } from '../../../types/contracts.js'
import { installActiveEnvironmentForTesting } from '../../../lib/activeEnvironment.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { createFakeBackend } from '../../testUtils/fakeBackend.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import { useOpenOracleOperations, type UseOpenOracleOperationsDependencies } from '../../../features/open-oracle/hooks/useOpenOracleOperations.js'
import { createOpenOracleReportMissingError } from '../../../protocol/index.js'

type UseOpenOracleOperationsState = ReturnType<typeof useOpenOracleOperations>
type TestOpenOracleWriteClient = { kind: 'injected-write-client' }

const OPEN_ORACLE_ADDRESS = getAddress('0x00000000000000000000000000000000000000aa')
const REPORT_ID = 1n
const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000bb')
const TOKEN1_ADDRESS = getAddress('0x00000000000000000000000000000000000000c1')
const TOKEN2_ADDRESS = getAddress('0x00000000000000000000000000000000000000c2')
const WETH_ADDRESS = getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
const STATE_HASH = '0x1111111111111111111111111111111111111111111111111111111111111111'

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

function createOpenOracleReportDetails(overrides: Partial<OpenOracleReportDetails> = {}): OpenOracleReportDetails {
	return {
		callbackContract: zeroAddress,
		callbackGasLimit: 0,
		currentAmount1: 100n,
		currentAmount2: 25n,
		currentBlockNumber: 10n,
		currentReporter: zeroAddress,
		currentTime: 10n,
		disputeDelay: 1n,
		disputeOccurred: false,
		escalationHalt: 0n,
		exactToken1Report: 100n,
		fee: 0n,
		feePercentage: 0n,
		initialReporter: zeroAddress,
		isDistributed: false,
		lastReportOppoTime: 0n,
		multiplier: 1n,
		numReports: 0n,
		openOracleAddress: OPEN_ORACLE_ADDRESS,
		price: 4n * 10n ** 30n,
		protocolFee: 0n,
		protocolFeeRecipient: zeroAddress,
		reportId: REPORT_ID,
		reportTimestamp: 0n,
		settlementTime: 10n,
		settlementTimestamp: 0n,
		settlerReward: 0n,
		stateHash: STATE_HASH,
		timeType: true,
		token1: TOKEN1_ADDRESS,
		token1Decimals: 18,
		token1Symbol: 'REP',
		token2: TOKEN2_ADDRESS,
		token2Decimals: 18,
		token2Symbol: 'WETH',
		trackDisputes: false,
		...overrides,
	}
}

function createOpenOracleOperationsDependencies(overrides: Partial<UseOpenOracleOperationsDependencies<TestOpenOracleWriteClient>> = {}): UseOpenOracleOperationsDependencies<TestOpenOracleWriteClient> {
	return {
		approveErc20: async () => {
			throw new Error('approveErc20 should not be called in this test')
		},
		createConnectedReadClient: mock(() => ({
			getBalance: async () => 0n,
			getBlockNumber: async () => 0n,
			readContract: async () => 18,
		})),
		createOpenOracleReportInstance: async () => {
			throw new Error('createOpenOracleReportInstance should not be called in this test')
		},
		createWalletWriteClient: mock(() => ({ kind: 'injected-write-client' as const })),
		disputeOracleReport: async () => {
			throw new Error('disputeOracleReport should not be called in this test')
		},
		loadOpenOracleInitialReportPriceResult: mock(async () => ({
			price: 4n * 10n ** 30n,
			priceSource: 'MOCK' as const,
			priceSourceUrl: undefined,
			status: 'success' as const,
			token2Amount: 25n,
		})),
		loadOpenOracleReportDetails: async () => {
			throw new Error('loadOpenOracleReportDetails should not be called in this test')
		},
		readOptionalMulticall: mock(async () => [
			{ result: 100n, status: 'success' as const },
			{ result: 25n, status: 'success' as const },
			{ result: 100n, status: 'success' as const },
			{ result: 25n, status: 'success' as const },
		]),
		settleOracleReport: async () => {
			throw new Error('settleOracleReport should not be called in this test')
		},
		submitInitialOracleReport: async () => {
			throw new Error('submitInitialOracleReport should not be called in this test')
		},
		wrapWeth: async () => {
			throw new Error('wrapWeth should not be called in this test')
		},
		...overrides,
	}
}

function createHarness(dependencies: UseOpenOracleOperationsDependencies<TestOpenOracleWriteClient>, onRender: (state: UseOpenOracleOperationsState) => void) {
	return function OpenOracleOperationsHarness() {
		const state = useOpenOracleOperations(
			{
				accountAddress: WALLET_ADDRESS,
				enabled: true,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
			},
			dependencies,
		)

		onRender(state)

		return <div />
	}
}

function requireHookState(state: UseOpenOracleOperationsState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')

	return state
}

describe('useOpenOracleOperations', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let restoreActiveEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		restoreActiveEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreActiveEnvironment?.()
		restoreActiveEnvironment = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		mock.restore()
	})

	test('distinguishes unsubmitted, missing, and failed report lookups', async () => {
		const secondReportId = 2n
		const dependencies = createOpenOracleOperationsDependencies({
			loadOpenOracleReportDetails: mock(async (_openOracleAddress: Address, reportId: bigint) => {
				if (reportId === REPORT_ID) throw createOpenOracleReportMissingError(reportId)
				throw new Error('RPC unavailable')
			}),
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(requireHookState(hookState).openOracleReportLookupState).toBe('unknown')
		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({ ...current, reportId: REPORT_ID.toString() }))
		})
		expect(requireHookState(hookState).openOracleReportLookupState).toBe('unknown')

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		expect(requireHookState(hookState).openOracleReportLookupState).toBe('missing')
		expect(requireHookState(hookState).openOracleError).toBeUndefined()

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({ ...current, reportId: secondReportId.toString() }))
		})
		expect(requireHookState(hookState).openOracleReportLookupState).toBe('unknown')

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(secondReportId.toString())
		})
		expect(requireHookState(hookState).openOracleReportLookupState).toBe('load-failed')
		expect(requireHookState(hookState).openOracleError).toContain('RPC unavailable')

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({ ...current, reportId: '3' }))
		})
		expect(requireHookState(hookState).openOracleReportLookupState).toBe('unknown')
		expect(requireHookState(hookState).openOracleError).toBeUndefined()
	})

	test('keeps a replacement report load independent from an older pending request', async () => {
		const secondReportId = 2n
		const firstReportLoad = createDeferred<OpenOracleReportDetails>()
		const secondReportLoad = createDeferred<OpenOracleReportDetails>()
		const dependencies = createOpenOracleOperationsDependencies({
			loadOpenOracleReportDetails: mock(async (_openOracleAddress: Address, reportId: bigint) => {
				if (reportId === REPORT_ID) return await firstReportLoad.promise
				if (reportId === secondReportId) return await secondReportLoad.promise
				throw new Error(`Unexpected report ${reportId.toString()}`)
			}),
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		let firstLoadPromise = Promise.resolve()
		await act(() => {
			firstLoadPromise = requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleReportLookupState).toBe('loading'))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({ ...current, reportId: secondReportId.toString() }))
		})
		expect(requireHookState(hookState).openOracleReportLookupState).toBe('unknown')

		let secondLoadPromise = Promise.resolve()
		await act(() => {
			secondLoadPromise = requireHookState(hookState).loadOracleReport(secondReportId.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleReportLookupState).toBe('loading'))

		await act(async () => {
			secondReportLoad.resolve(createOpenOracleReportDetails({ reportId: secondReportId }))
			await secondLoadPromise
		})
		expect(requireHookState(hookState).openOracleReportLookupState).toBe('ready')
		expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(secondReportId)

		await act(async () => {
			firstReportLoad.resolve(createOpenOracleReportDetails())
			await firstLoadPromise
		})
		expect(requireHookState(hookState).openOracleReportLookupState).toBe('ready')
		expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(secondReportId)
	})

	test('invalidates loaded report state when the selected report ID changes', async () => {
		const reportDetails = createOpenOracleReportDetails()
		const dependencies = createOpenOracleOperationsDependencies({
			loadOpenOracleReportDetails: mock(async () => reportDetails),
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(REPORT_ID)
		expect(requireHookState(hookState).openOracleReportLookupState).toBe('ready')

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({ ...current, reportId: '2' }))
		})
		expect(requireHookState(hookState).openOracleReportLookupState).toBe('unknown')
		expect(requireHookState(hookState).openOracleReportDetails).toBeUndefined()
		expect(requireHookState(hookState).openOracleError).toBeUndefined()
	})

	test('submitInitialReport reloads token access after a successful write', async () => {
		const reportDetails = createOpenOracleReportDetails()
		const readOptionalMulticall = mock(async () => [
			{ result: 100n, status: 'success' as const },
			{ result: 25n, status: 'success' as const },
			{ result: 100n, status: 'success' as const },
			{ result: 25n, status: 'success' as const },
		])
		const submitInitialOracleReport = mock(async () => ({
			action: 'submitInitialReport' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d1' as const,
		}))

		const dependencies = createOpenOracleOperationsDependencies({
			loadOpenOracleReportDetails: mock(async () => reportDetails),
			readOptionalMulticall,
			submitInitialOracleReport,
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => {
			expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(REPORT_ID)
		})
		await waitFor(() => {
			expect(readOptionalMulticall).toHaveBeenCalledTimes(1)
		})

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				price: '4',
				reportId: REPORT_ID.toString(),
				stateHash: STATE_HASH,
			}))
		})

		const tokenAccessLoadsBeforeSubmit = readOptionalMulticall.mock.calls.length

		await act(async () => {
			await requireHookState(hookState).submitInitialReport()
		})

		expect(submitInitialOracleReport).toHaveBeenCalledTimes(1)
		expect(readOptionalMulticall.mock.calls.length).toBe(tokenAccessLoadsBeforeSubmit + 2)
	})

	test('approveToken1 and approveToken2 reject stale loaded details after the selected report changes', async () => {
		const secondReportId = 2n
		const firstReportDetails = createOpenOracleReportDetails()
		let tokenAccessLoadCount = 0
		const approveErc20 = mock(async () => ({
			action: 'approveToken1' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d7' as const,
		}))

		const dependencies = createOpenOracleOperationsDependencies({
			approveErc20,
			loadOpenOracleReportDetails: mock(async (_openOracleAddress: Address, reportId: bigint) => {
				if (reportId === REPORT_ID) return firstReportDetails
				if (reportId === secondReportId) return createOpenOracleReportDetails({ reportId: secondReportId })
				throw new Error(`Unexpected report ${reportId.toString()}`)
			}),
			readOptionalMulticall: mock(async () => {
				tokenAccessLoadCount += 1
				return [
					{ result: 100n, status: 'success' as const },
					{ result: 25n, status: 'success' as const },
					{ result: 100n, status: 'success' as const },
					{ result: 25n, status: 'success' as const },
				]
			}),
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(REPORT_ID))
		expect(tokenAccessLoadCount).toBe(1)

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				reportId: secondReportId.toString(),
			}))
		})

		await act(async () => {
			await requireHookState(hookState).approveToken1()
		})

		expect(requireHookState(hookState).openOracleFeedback?.status.tone).toBe('error')
		expect(approveErc20).not.toHaveBeenCalled()
		expect(tokenAccessLoadCount).toBe(1)

		await act(async () => {
			await requireHookState(hookState).approveToken2()
		})

		expect(requireHookState(hookState).openOracleFeedback?.status.tone).toBe('error')
		expect(approveErc20).not.toHaveBeenCalled()
		expect(tokenAccessLoadCount).toBe(1)
	})

	test('settleReport ignores a stale post-success refresh after the selected report changes', async () => {
		const secondReportId = 2n
		const firstReportDetails = createOpenOracleReportDetails({
			currentTime: 11n,
			currentReporter: WALLET_ADDRESS,
			reportId: REPORT_ID,
			reportTimestamp: 1n,
		})
		const secondReportDetails = createOpenOracleReportDetails({
			currentTime: 11n,
			currentReporter: WALLET_ADDRESS,
			reportId: secondReportId,
			reportTimestamp: 1n,
		})
		const staleRefresh = createDeferred<OpenOracleReportDetails>()
		let firstReportLoadCount = 0
		const loadOpenOracleReportDetails = mock(async (_openOracleAddress: Address, reportId: bigint) => {
			if (reportId === REPORT_ID) {
				firstReportLoadCount += 1
				if (firstReportLoadCount <= 2) return firstReportDetails
				return await staleRefresh.promise
			}
			if (reportId === secondReportId) return secondReportDetails
			throw new Error(`Unexpected report ${reportId.toString()}`)
		})
		const readOptionalMulticall = mock(async () => [
			{ result: 100n, status: 'success' as const },
			{ result: 25n, status: 'success' as const },
			{ result: 100n, status: 'success' as const },
			{ result: 25n, status: 'success' as const },
		])
		const settleOracleReport = mock(async () => ({
			action: 'settle' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d2' as const,
		}))

		const dependencies = createOpenOracleOperationsDependencies({
			loadOpenOracleReportDetails,
			readOptionalMulticall,
			settleOracleReport,
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(REPORT_ID))

		let settlePromise = Promise.resolve()
		await act(() => {
			settlePromise = requireHookState(hookState).settleReport()
		})

		await waitFor(() => expect(loadOpenOracleReportDetails).toHaveBeenCalledTimes(3))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				reportId: secondReportId.toString(),
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(secondReportId.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(secondReportId))

		await act(async () => {
			staleRefresh.resolve(firstReportDetails)
			await settlePromise
		})

		expect(requireHookState(hookState).openOracleForm.reportId).toBe(secondReportId.toString())
		expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(secondReportId)
		expect(settleOracleReport).toHaveBeenCalledTimes(1)
	})

	test('settleReport blocks a stale pre-write reload after the selected report changes', async () => {
		const secondReportId = 2n
		const firstReportDetails = createOpenOracleReportDetails({
			currentTime: 11n,
			currentReporter: WALLET_ADDRESS,
			reportId: REPORT_ID,
			reportTimestamp: 1n,
		})
		const secondReportDetails = createOpenOracleReportDetails({
			currentTime: 11n,
			currentReporter: WALLET_ADDRESS,
			reportId: secondReportId,
			reportTimestamp: 1n,
		})
		const stalePreflightReload = createDeferred<OpenOracleReportDetails>()
		let firstReportLoadCount = 0
		const loadOpenOracleReportDetails = mock(async (_openOracleAddress: Address, reportId: bigint) => {
			if (reportId === REPORT_ID) {
				firstReportLoadCount += 1
				if (firstReportLoadCount === 1) return firstReportDetails
				return await stalePreflightReload.promise
			}
			if (reportId === secondReportId) return secondReportDetails
			throw new Error(`Unexpected report ${reportId.toString()}`)
		})
		const readOptionalMulticall = mock(async () => [
			{ result: 100n, status: 'success' as const },
			{ result: 25n, status: 'success' as const },
			{ result: 100n, status: 'success' as const },
			{ result: 25n, status: 'success' as const },
		])
		const settleOracleReport = mock(async () => ({
			action: 'settle' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d9' as const,
		}))

		const dependencies = createOpenOracleOperationsDependencies({
			loadOpenOracleReportDetails,
			readOptionalMulticall,
			settleOracleReport,
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(REPORT_ID))

		let settlePromise = Promise.resolve()
		await act(() => {
			settlePromise = requireHookState(hookState).settleReport()
		})

		await waitFor(() => expect(loadOpenOracleReportDetails).toHaveBeenCalledTimes(2))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				reportId: secondReportId.toString(),
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(secondReportId.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(secondReportId))

		await act(async () => {
			stalePreflightReload.resolve(firstReportDetails)
			await settlePromise
		})

		expect(requireHookState(hookState).openOracleForm.reportId).toBe(secondReportId.toString())
		expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(secondReportId)
		expect(requireHookState(hookState).openOracleFeedback?.status.tone).toBe('error')
		expect(requireHookState(hookState).openOracleFeedback?.status.detail).toBe('Selected report changed. Review the current report and try again')
		expect(settleOracleReport).not.toHaveBeenCalled()
	})

	test('ignores stale quote and token-access refreshes after the selected report changes', async () => {
		const secondReportId = 2n
		const firstReportDetails = createOpenOracleReportDetails({
			currentReporter: WALLET_ADDRESS,
			reportId: REPORT_ID,
			reportTimestamp: 1n,
		})
		const secondReportDetails = createOpenOracleReportDetails({
			currentAmount1: 200n,
			currentAmount2: 35n,
			currentReporter: WALLET_ADDRESS,
			exactToken1Report: 200n,
			reportId: secondReportId,
			reportTimestamp: 1n,
			stateHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
		})
		const staleQuote = createDeferred<{
			price: bigint
			priceSource: 'MOCK'
			priceSourceUrl: undefined
			status: 'success'
			token2Amount: bigint
		}>()
		const staleTokenAccess = createDeferred<[{ result: bigint; status: 'success' }, { result: bigint; status: 'success' }, { result: bigint; status: 'success' }, { result: bigint; status: 'success' }]>()
		let quoteLoadCount = 0
		let tokenAccessLoadCount = 0
		const readClient = {
			getBalance: mock(async () => 5n * 10n ** 18n),
			getBlockNumber: mock(async () => 123n),
			readContract: mock(async () => 18),
		}

		const dependencies = createOpenOracleOperationsDependencies({
			createConnectedReadClient: mock(() => readClient),
			loadOpenOracleReportDetails: mock(async (_openOracleAddress: Address, reportId: bigint) => {
				if (reportId === REPORT_ID) return firstReportDetails
				if (reportId === secondReportId) return secondReportDetails
				throw new Error(`Unexpected report ${reportId.toString()}`)
			}),
			readOptionalMulticall: mock(async () => {
				tokenAccessLoadCount += 1
				if (tokenAccessLoadCount === 1) return await staleTokenAccess.promise
				return [
					{ result: 200n, status: 'success' as const },
					{ result: 35n, status: 'success' as const },
					{ result: 200n, status: 'success' as const },
					{ result: 35n, status: 'success' as const },
				]
			}),
			loadOpenOracleInitialReportPriceResult: mock(async () => {
				quoteLoadCount += 1
				if (quoteLoadCount === 1) return await staleQuote.promise
				return {
					price: 7n * 10n ** 30n,
					priceSource: 'MOCK' as const,
					priceSourceUrl: undefined,
					status: 'success' as const,
					token2Amount: 35n,
				}
			}),
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => expect(quoteLoadCount).toBe(1))
		await waitFor(() => expect(tokenAccessLoadCount).toBe(1))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				reportId: secondReportId.toString(),
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(secondReportId.toString())
		})

		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(secondReportId))
		await waitFor(() => expect(requireHookState(hookState).openOracleForm.price).toBe('7'))
		await waitFor(() => expect(requireHookState(hookState).openOracleInitialReportState.token1Approval.value).toBe(200n))
		expect(requireHookState(hookState).openOracleInitialReportState.token1Balance).toBe(200n)
		expect(requireHookState(hookState).openOracleInitialReportState.token2Approval.value).toBe(35n)
		expect(requireHookState(hookState).openOracleInitialReportState.token2Balance).toBe(35n)

		await act(async () => {
			staleQuote.resolve({
				price: 4n * 10n ** 30n,
				priceSource: 'MOCK',
				priceSourceUrl: undefined,
				status: 'success',
				token2Amount: 25n,
			})
			staleTokenAccess.resolve([
				{ result: 100n, status: 'success' },
				{ result: 25n, status: 'success' },
				{ result: 100n, status: 'success' },
				{ result: 25n, status: 'success' },
			])
			await Promise.resolve()
		})

		expect(requireHookState(hookState).openOracleForm.reportId).toBe(secondReportId.toString())
		expect(requireHookState(hookState).openOracleForm.price).toBe('7')
		expect(requireHookState(hookState).openOracleForm.amount1).toBe('200')
		expect(requireHookState(hookState).openOracleForm.amount2).toBe('35')
		expect(requireHookState(hookState).openOracleInitialReportState.defaultPrice).toBe('7')
		expect(requireHookState(hookState).openOracleInitialReportState.token1Approval.value).toBe(200n)
		expect(requireHookState(hookState).openOracleInitialReportState.token1Balance).toBe(200n)
		expect(requireHookState(hookState).openOracleInitialReportState.token2Approval.value).toBe(35n)
		expect(requireHookState(hookState).openOracleInitialReportState.token2Balance).toBe(35n)
	})

	test('submitInitialReport replaces a stale auto-filled quote before writing', async () => {
		const originalDateNow = Date.now
		let nowMs = 1_000_000
		Date.now = () => nowMs
		try {
			const reportDetails = createOpenOracleReportDetails()
			const readOptionalMulticall = mock(async () => [
				{ result: 100n, status: 'success' as const },
				{ result: 25n, status: 'success' as const },
				{ result: 100n, status: 'success' as const },
				{ result: 25n, status: 'success' as const },
			])
			const submitInitialOracleReport = mock(async (_client: unknown, _openOracleAddress: string, _reportId: bigint, _amount1: bigint, _amount2: bigint, _stateHash: string) => ({
				action: 'submitInitialReport' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000d3' as const,
			}))
			let quoteLoadCount = 0
			const loadOpenOracleInitialReportPriceResult = mock(async () => {
				quoteLoadCount += 1
				const refreshedQuote = quoteLoadCount > 1
				return {
					price: (refreshedQuote ? 5n : 4n) * 10n ** 30n,
					priceSource: 'MOCK' as const,
					priceSourceUrl: undefined,
					status: 'success' as const,
					token2Amount: refreshedQuote ? 20n : 25n,
				}
			})

			const dependencies = createOpenOracleOperationsDependencies({
				createConnectedReadClient: mock(() => ({
					getBalance: async () => 0n,
					getBlockNumber: async () => 10n,
					readContract: async () => 18,
				})),
				loadOpenOracleReportDetails: mock(async () => reportDetails),
				readOptionalMulticall,
				submitInitialOracleReport,
				loadOpenOracleInitialReportPriceResult,
			})
			let hookState: UseOpenOracleOperationsState | undefined
			const Harness = createHarness(dependencies, state => {
				hookState = state
			})
			const renderedComponent = await renderIntoDocument(h(Harness, {}))
			cleanupRenderedComponent = renderedComponent.cleanup

			await act(async () => {
				await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
			})
			await waitFor(() => {
				expect(requireHookState(hookState).openOracleForm.price).toBe('4')
			})

			await act(async () => {
				requireHookState(hookState).setOpenOracleForm(current => ({
					...current,
					reportId: REPORT_ID.toString(),
					stateHash: STATE_HASH,
				}))
			})
			nowMs += 6 * 60 * 1000

			await act(async () => {
				await requireHookState(hookState).submitInitialReport()
			})

			expect(loadOpenOracleInitialReportPriceResult).toHaveBeenCalledTimes(2)
			expect(requireHookState(hookState).openOracleForm.price).toBe('5')
			expect(submitInitialOracleReport.mock.calls[0]?.[3]).toBe(100n)
			expect(submitInitialOracleReport.mock.calls[0]?.[4]).toBe(20n)
		} finally {
			Date.now = originalDateNow
		}
	})

	test('submitInitialReport blocks a stale token-access refresh after the selected report changes', async () => {
		const secondReportId = 2n
		const firstReportDetails = createOpenOracleReportDetails()
		const secondReportDetails = createOpenOracleReportDetails({
			currentAmount1: 200n,
			currentAmount2: 35n,
			exactToken1Report: 200n,
			reportId: secondReportId,
			stateHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
		})
		const staleTokenAccess = createDeferred<[{ result: bigint; status: 'success' }, { result: bigint; status: 'success' }, { result: bigint; status: 'success' }, { result: bigint; status: 'success' }]>()
		let tokenAccessLoadCount = 0
		const submitInitialOracleReport = mock(async () => ({
			action: 'submitInitialReport' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d5' as const,
		}))
		const readClient = {
			getBalance: mock(async () => 5n * 10n ** 18n),
			getBlockNumber: mock(async () => 123n),
			readContract: mock(async () => 18),
		}

		const dependencies = createOpenOracleOperationsDependencies({
			createConnectedReadClient: mock(() => readClient),
			loadOpenOracleReportDetails: mock(async (_openOracleAddress: Address, reportId: bigint) => {
				if (reportId === REPORT_ID) return firstReportDetails
				if (reportId === secondReportId) return secondReportDetails
				throw new Error(`Unexpected report ${reportId.toString()}`)
			}),
			readOptionalMulticall: mock(async () => {
				tokenAccessLoadCount += 1
				if (tokenAccessLoadCount === 2) return await staleTokenAccess.promise
				return [
					{ result: 200n, status: 'success' as const },
					{ result: 35n, status: 'success' as const },
					{ result: 200n, status: 'success' as const },
					{ result: 35n, status: 'success' as const },
				]
			}),
			submitInitialOracleReport,
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 7n * 10n ** 30n,
				priceSource: 'MOCK' as const,
				priceSourceUrl: undefined,
				status: 'success' as const,
				token2Amount: 35n,
			})),
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(REPORT_ID))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				price: '4',
				reportId: REPORT_ID.toString(),
				stateHash: STATE_HASH,
			}))
		})

		let submitPromise = Promise.resolve()
		await act(() => {
			submitPromise = requireHookState(hookState).submitInitialReport()
		})

		await waitFor(() => expect(tokenAccessLoadCount).toBe(2))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				reportId: secondReportId.toString(),
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(secondReportId.toString())
		})

		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(secondReportId))

		await act(async () => {
			staleTokenAccess.resolve([
				{ result: 100n, status: 'success' },
				{ result: 25n, status: 'success' },
				{ result: 100n, status: 'success' },
				{ result: 25n, status: 'success' },
			])
			await submitPromise
		})

		expect(requireHookState(hookState).openOracleForm.reportId).toBe(secondReportId.toString())
		expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(secondReportId)
		expect(requireHookState(hookState).openOracleFeedback?.status.tone).toBe('error')
		expect(submitInitialOracleReport).not.toHaveBeenCalled()
	})

	test('wrapWethForInitialReport blocks a stale token-access refresh after the selected report changes', async () => {
		const secondReportId = 2n
		const firstReportDetails = createOpenOracleReportDetails()
		const secondReportDetails = createOpenOracleReportDetails({
			currentAmount1: 200n,
			currentAmount2: 35n,
			exactToken1Report: 200n,
			reportId: secondReportId,
			stateHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
		})
		const staleTokenAccess = createDeferred<[{ result: bigint; status: 'success' }, { result: bigint; status: 'success' }, { result: bigint; status: 'success' }, { result: bigint; status: 'success' }]>()
		let tokenAccessLoadCount = 0
		const wrapWeth = mock(async () => ({
			action: 'wrapWeth' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d6' as const,
		}))
		const readClient = {
			getBalance: mock(async () => 5n * 10n ** 18n),
			getBlockNumber: mock(async () => 123n),
			readContract: mock(async () => 18),
		}

		const dependencies = createOpenOracleOperationsDependencies({
			createConnectedReadClient: mock(() => readClient),
			loadOpenOracleReportDetails: mock(async (_openOracleAddress: Address, reportId: bigint) => {
				if (reportId === REPORT_ID) return firstReportDetails
				if (reportId === secondReportId) return secondReportDetails
				throw new Error(`Unexpected report ${reportId.toString()}`)
			}),
			readOptionalMulticall: mock(async () => {
				tokenAccessLoadCount += 1
				if (tokenAccessLoadCount === 2) return await staleTokenAccess.promise
				return [
					{ result: 200n, status: 'success' as const },
					{ result: 35n, status: 'success' as const },
					{ result: 200n, status: 'success' as const },
					{ result: 35n, status: 'success' as const },
				]
			}),
			wrapWeth,
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 7n * 10n ** 30n,
				priceSource: 'MOCK' as const,
				priceSourceUrl: undefined,
				status: 'success' as const,
				token2Amount: 35n,
			})),
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(REPORT_ID))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				reportId: REPORT_ID.toString(),
				stateHash: STATE_HASH,
			}))
		})

		let wrapPromise = Promise.resolve()
		await act(() => {
			wrapPromise = requireHookState(hookState).wrapWethForInitialReport()
		})

		await waitFor(() => expect(tokenAccessLoadCount).toBe(2))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				reportId: secondReportId.toString(),
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(secondReportId.toString())
		})

		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(secondReportId))

		await act(async () => {
			staleTokenAccess.resolve([
				{ result: 100n, status: 'success' },
				{ result: 25n, status: 'success' },
				{ result: 100n, status: 'success' },
				{ result: 25n, status: 'success' },
			])
			await wrapPromise
		})

		expect(requireHookState(hookState).openOracleForm.reportId).toBe(secondReportId.toString())
		expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(secondReportId)
		expect(requireHookState(hookState).openOracleFeedback?.status.tone).toBe('error')
		expect(wrapWeth).not.toHaveBeenCalled()
	})

	test('submitInitialReport blocks a stale auto-filled quote when refresh throws', async () => {
		const originalDateNow = Date.now
		let nowMs = 2_000_000
		Date.now = () => nowMs
		try {
			const reportDetails = createOpenOracleReportDetails()
			const readOptionalMulticall = mock(async () => [
				{ result: 100n, status: 'success' as const },
				{ result: 25n, status: 'success' as const },
				{ result: 100n, status: 'success' as const },
				{ result: 25n, status: 'success' as const },
			])
			const submitInitialOracleReport = mock(async () => ({
				action: 'submitInitialReport' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000d4' as const,
			}))
			let quoteLoadCount = 0
			const loadOpenOracleInitialReportPriceResult = mock(async () => {
				quoteLoadCount += 1
				if (quoteLoadCount > 1) throw new Error('Stale quote RPC unavailable')
				return {
					price: 4n * 10n ** 30n,
					priceSource: 'MOCK' as const,
					priceSourceUrl: undefined,
					status: 'success' as const,
					token2Amount: 25n,
				}
			})

			const dependencies = createOpenOracleOperationsDependencies({
				createConnectedReadClient: mock(() => ({
					getBalance: async () => 0n,
					getBlockNumber: async () => 10n,
					readContract: async () => 18,
				})),
				loadOpenOracleReportDetails: mock(async () => reportDetails),
				readOptionalMulticall,
				submitInitialOracleReport,
				loadOpenOracleInitialReportPriceResult,
			})
			let hookState: UseOpenOracleOperationsState | undefined
			const Harness = createHarness(dependencies, state => {
				hookState = state
			})
			const renderedComponent = await renderIntoDocument(h(Harness, {}))
			cleanupRenderedComponent = renderedComponent.cleanup

			await act(async () => {
				await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
			})
			await waitFor(() => {
				expect(requireHookState(hookState).openOracleForm.price).toBe('4')
			})

			await act(async () => {
				requireHookState(hookState).setOpenOracleForm(current => ({
					...current,
					reportId: REPORT_ID.toString(),
					stateHash: STATE_HASH,
				}))
			})
			nowMs += 6 * 60 * 1000

			await act(async () => {
				await requireHookState(hookState).submitInitialReport()
			})

			expect(loadOpenOracleInitialReportPriceResult).toHaveBeenCalledTimes(2)
			expect(requireHookState(hookState).openOracleForm.price).toBe('')
			expect(requireHookState(hookState).openOracleFeedback?.status.tone).toBe('error')
			expect(requireHookState(hookState).openOracleFeedback?.status.detail).toBe('Automatic price quote is stale and could not be refreshed. Refresh the quote or enter a manual price before submitting')
			expect(submitInitialOracleReport).not.toHaveBeenCalled()
		} finally {
			Date.now = originalDateNow
		}
	})

	test('disputeReport blocks a stale token-access refresh after the selected report changes', async () => {
		const secondReportId = 2n
		const firstReportDetails = createOpenOracleReportDetails({
			currentAmount1: 99n,
			currentReporter: WALLET_ADDRESS,
			reportTimestamp: 1n,
		})
		const secondReportDetails = createOpenOracleReportDetails({
			currentAmount1: 200n,
			currentAmount2: 35n,
			currentReporter: WALLET_ADDRESS,
			exactToken1Report: 200n,
			reportId: secondReportId,
			reportTimestamp: 1n,
			stateHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
		})
		const staleTokenAccess = createDeferred<[{ result: bigint; status: 'success' }, { result: bigint; status: 'success' }, { result: bigint; status: 'success' }, { result: bigint; status: 'success' }]>()
		let tokenAccessLoadCount = 0
		const disputeOracleReport = mock(async () => ({
			action: 'dispute' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d6' as const,
		}))
		const readClient = {
			getBalance: mock(async () => 5n * 10n ** 18n),
			getBlockNumber: mock(async () => 123n),
			readContract: mock(async () => 18),
		}

		const dependencies = createOpenOracleOperationsDependencies({
			createConnectedReadClient: mock(() => readClient),
			disputeOracleReport,
			loadOpenOracleReportDetails: mock(async (_openOracleAddress: Address, reportId: bigint) => {
				if (reportId === REPORT_ID) return firstReportDetails
				if (reportId === secondReportId) return secondReportDetails
				throw new Error(`Unexpected report ${reportId.toString()}`)
			}),
			readOptionalMulticall: mock(async () => {
				tokenAccessLoadCount += 1
				if (tokenAccessLoadCount === 2) return await staleTokenAccess.promise
				return [
					{ result: 200n, status: 'success' as const },
					{ result: 35n, status: 'success' as const },
					{ result: 200n, status: 'success' as const },
					{ result: 35n, status: 'success' as const },
				]
			}),
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 7n * 10n ** 30n,
				priceSource: 'MOCK' as const,
				priceSourceUrl: undefined,
				status: 'success' as const,
				token2Amount: 35n,
			})),
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(REPORT_ID))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				disputeNewAmount1: '100',
				disputeNewAmount2: '25',
				disputeTokenToSwap: 'token1',
				reportId: REPORT_ID.toString(),
				stateHash: STATE_HASH,
			}))
		})

		let disputePromise = Promise.resolve()
		await act(() => {
			disputePromise = requireHookState(hookState).disputeReport()
		})

		await waitFor(() => expect(tokenAccessLoadCount).toBe(2))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				reportId: secondReportId.toString(),
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(secondReportId.toString())
		})

		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(secondReportId))

		await act(async () => {
			staleTokenAccess.resolve([
				{ result: 100n, status: 'success' },
				{ result: 25n, status: 'success' },
				{ result: 100n, status: 'success' },
				{ result: 25n, status: 'success' },
			])
			await disputePromise
		})

		expect(requireHookState(hookState).openOracleForm.reportId).toBe(secondReportId.toString())
		expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(secondReportId)
		expect(requireHookState(hookState).openOracleFeedback?.status.tone).toBe('error')
		expect(disputeOracleReport).not.toHaveBeenCalled()
	})

	test('disputeReport reloads token access after a successful write', async () => {
		const reportDetails = createOpenOracleReportDetails({
			currentAmount1: 149n,
			currentReporter: WALLET_ADDRESS,
			initialReporter: WALLET_ADDRESS,
			reportTimestamp: 5n,
		})
		const readOptionalMulticall = mock(async () => [
			{ result: 500n, status: 'success' as const },
			{ result: 500n, status: 'success' as const },
			{ result: 500n, status: 'success' as const },
			{ result: 500n, status: 'success' as const },
		])
		const disputeOracleReport = mock(async () => ({
			action: 'dispute' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d2' as const,
		}))

		const dependencies = createOpenOracleOperationsDependencies({
			disputeOracleReport,
			loadOpenOracleReportDetails: mock(async () => reportDetails),
			readOptionalMulticall,
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 4n * 10n ** 30n,
				priceSource: 'MOCK' as const,
				priceSourceUrl: undefined,
				status: 'success' as const,
				token2Amount: 25n,
			})),
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => {
			expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(REPORT_ID)
		})
		await waitFor(() => {
			expect(readOptionalMulticall).toHaveBeenCalledTimes(1)
		})

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				disputeNewAmount1: '150',
				disputeNewAmount2: '35',
				reportId: REPORT_ID.toString(),
				stateHash: STATE_HASH,
			}))
		})

		const tokenAccessLoadsBeforeDispute = readOptionalMulticall.mock.calls.length

		await act(async () => {
			await requireHookState(hookState).disputeReport()
		})

		expect(disputeOracleReport).toHaveBeenCalledTimes(1)
		expect(readOptionalMulticall.mock.calls.length).toBe(tokenAccessLoadsBeforeDispute + 2)
	})

	test('createOpenOracleGame snapshots the submitted create form before decimals resolve', async () => {
		const editedToken1Address = getAddress('0x00000000000000000000000000000000000000d1')
		const editedToken2Address = getAddress('0x00000000000000000000000000000000000000d2')
		const token1Decimals = createDeferred<number>()
		const createOpenOracleReportInstance = mock(async (_client: unknown, submission: { exactToken1Report: bigint; token1Address: Address; token2Address: Address }) => {
			expect(submission.exactToken1Report).toBe(10n * 10n ** 18n)
			expect(submission.token1Address).toBe(TOKEN1_ADDRESS)
			expect(submission.token2Address).toBe(TOKEN2_ADDRESS)
			return {
				action: 'createReportInstance' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000e1' as const,
			}
		})

		const dependencies = createOpenOracleOperationsDependencies({
			createConnectedReadClient: mock(() => ({
				getBalance: mock(async () => 5n * 10n ** 18n),
				getBlockNumber: mock(async () => 123n),
				readContract: mock(async () => await token1Decimals.promise),
			})),
			createOpenOracleReportInstance,
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setOpenOracleCreateForm(current => ({
				...current,
				exactToken1Report: '10',
				token1Address: TOKEN1_ADDRESS,
				token2Address: TOKEN2_ADDRESS,
			}))
		})

		let createPromise = Promise.resolve()
		await act(() => {
			createPromise = requireHookState(hookState).createOpenOracleGame()
		})

		await act(async () => {
			requireHookState(hookState).setOpenOracleCreateForm(current => ({
				...current,
				exactToken1Report: '20',
				token1Address: editedToken1Address,
				token2Address: editedToken2Address,
			}))
		})

		await act(async () => {
			token1Decimals.resolve(18)
			await createPromise
		})

		expect(createOpenOracleReportInstance).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).openOracleFeedback?.status.tone).toBe('success')
	})

	test('submitInitialReport snapshots the submitted price and state hash before token access refresh resolves', async () => {
		const editedStateHash = '0x2222222222222222222222222222222222222222222222222222222222222222'
		const staleTokenAccess = createDeferred<[{ result: bigint; status: 'success' }, { result: bigint; status: 'success' }, { result: bigint; status: 'success' }, { result: bigint; status: 'success' }]>()
		let tokenAccessLoadCount = 0
		const submitInitialOracleReport = mock(async (_client: unknown, _oracleAddress: Address, reportId: bigint, amount1: bigint, amount2: bigint, stateHash: string) => {
			expect(reportId).toBe(REPORT_ID)
			expect(amount1).toBe(100n)
			expect(amount2).toBe(25n)
			expect(stateHash).toBe(STATE_HASH)
			return {
				action: 'submitInitialReport' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000e2' as const,
			}
		})

		const dependencies = createOpenOracleOperationsDependencies({
			createConnectedReadClient: mock(() => ({
				getBalance: async () => 0n,
				getBlockNumber: async () => 123n,
				readContract: async () => 18,
			})),
			loadOpenOracleReportDetails: mock(async () => createOpenOracleReportDetails()),
			readOptionalMulticall: mock(async () => {
				tokenAccessLoadCount += 1
				if (tokenAccessLoadCount === 2) return await staleTokenAccess.promise
				return [
					{ result: 100n, status: 'success' as const },
					{ result: 25n, status: 'success' as const },
					{ result: 100n, status: 'success' as const },
					{ result: 25n, status: 'success' as const },
				]
			}),
			submitInitialOracleReport,
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 4n * 10n ** 30n,
				priceSource: 'MOCK' as const,
				priceSourceUrl: undefined,
				status: 'success' as const,
				token2Amount: 25n,
			})),
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(REPORT_ID))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				price: '4',
				reportId: REPORT_ID.toString(),
				stateHash: STATE_HASH,
			}))
		})

		let submitPromise = Promise.resolve()
		await act(() => {
			submitPromise = requireHookState(hookState).submitInitialReport()
		})

		await waitFor(() => expect(tokenAccessLoadCount).toBe(2))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				price: '5',
				stateHash: editedStateHash,
			}))
		})

		await act(async () => {
			staleTokenAccess.resolve([
				{ result: 100n, status: 'success' },
				{ result: 25n, status: 'success' },
				{ result: 100n, status: 'success' },
				{ result: 25n, status: 'success' },
			])
			await submitPromise
		})

		expect(submitInitialOracleReport).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).openOracleFeedback?.status.tone).toBe('success')
	})

	test('wrapWethForInitialReport snapshots the submitted price before token access refresh resolves', async () => {
		const staleTokenAccess = createDeferred<[{ result: bigint; status: 'success' }, { result: bigint; status: 'success' }, { result: bigint; status: 'success' }, { result: bigint; status: 'success' }]>()
		let tokenAccessLoadCount = 0
		const wrapWeth = mock(async (_client: unknown, amount: bigint) => {
			expect(amount).toBe(1n)
			return {
				action: 'wrapWeth' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000e3' as const,
			}
		})

		const dependencies = createOpenOracleOperationsDependencies({
			createConnectedReadClient: mock(() => ({
				getBalance: async () => 1_000n,
				getBlockNumber: async () => 123n,
				readContract: async () => 18,
			})),
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 4n * 10n ** 30n,
				priceSource: 'MOCK' as const,
				priceSourceUrl: undefined,
				status: 'success' as const,
				token2Amount: 25n,
			})),
			loadOpenOracleReportDetails: mock(async () => createOpenOracleReportDetails({ token2: WETH_ADDRESS })),
			readOptionalMulticall: mock(async () => {
				tokenAccessLoadCount += 1
				if (tokenAccessLoadCount === 2) return await staleTokenAccess.promise
				return [
					{ result: 100n, status: 'success' as const },
					{ result: 25n, status: 'success' as const },
					{ result: 100n, status: 'success' as const },
					{ result: 24n, status: 'success' as const },
				]
			}),
			wrapWeth,
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(REPORT_ID))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				price: '4',
				reportId: REPORT_ID.toString(),
			}))
		})

		let wrapPromise = Promise.resolve()
		await act(() => {
			wrapPromise = requireHookState(hookState).wrapWethForInitialReport()
		})

		await waitFor(() => expect(tokenAccessLoadCount).toBe(2))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				price: '5',
			}))
		})

		await act(async () => {
			staleTokenAccess.resolve([
				{ result: 100n, status: 'success' },
				{ result: 25n, status: 'success' },
				{ result: 100n, status: 'success' },
				{ result: 24n, status: 'success' },
			])
			await wrapPromise
		})

		expect(wrapWeth).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).openOracleFeedback?.status.tone).toBe('success')
	})

	test('disputeReport snapshots the submitted dispute inputs before token access refresh resolves', async () => {
		const editedStateHash = '0x3333333333333333333333333333333333333333333333333333333333333333'
		const staleTokenAccess = createDeferred<[{ result: bigint; status: 'success' }, { result: bigint; status: 'success' }, { result: bigint; status: 'success' }, { result: bigint; status: 'success' }]>()
		let tokenAccessLoadCount = 0
		const disputeOracleReport = mock(async (_client: unknown, _oracleAddress: Address, reportId: bigint, tokenToSwap: Address, amount1: bigint, amount2: bigint, currentAmount2: bigint, stateHash: string) => {
			expect(reportId).toBe(REPORT_ID)
			expect(tokenToSwap).toBe(TOKEN1_ADDRESS)
			expect(amount1).toBe(150n)
			expect(amount2).toBe(35n)
			expect(currentAmount2).toBe(25n)
			expect(stateHash).toBe(STATE_HASH)
			return {
				action: 'dispute' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000e4' as const,
			}
		})

		const dependencies = createOpenOracleOperationsDependencies({
			createConnectedReadClient: mock(() => ({
				getBalance: async () => 0n,
				getBlockNumber: async () => 123n,
				readContract: async () => 18,
			})),
			disputeOracleReport,
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 4n * 10n ** 30n,
				priceSource: 'MOCK' as const,
				priceSourceUrl: undefined,
				status: 'success' as const,
				token2Amount: 25n,
			})),
			loadOpenOracleReportDetails: mock(async () =>
				createOpenOracleReportDetails({
					currentAmount1: 149n,
					currentReporter: WALLET_ADDRESS,
					reportTimestamp: 1n,
				}),
			),
			readOptionalMulticall: mock(async () => {
				tokenAccessLoadCount += 1
				if (tokenAccessLoadCount === 2) return await staleTokenAccess.promise
				return [
					{ result: 500n, status: 'success' as const },
					{ result: 500n, status: 'success' as const },
					{ result: 500n, status: 'success' as const },
					{ result: 500n, status: 'success' as const },
				]
			}),
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(REPORT_ID))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				disputeNewAmount1: '150',
				disputeNewAmount2: '35',
				disputeTokenToSwap: 'token1',
				reportId: REPORT_ID.toString(),
				stateHash: STATE_HASH,
			}))
		})

		let disputePromise = Promise.resolve()
		await act(() => {
			disputePromise = requireHookState(hookState).disputeReport()
		})

		await waitFor(() => expect(tokenAccessLoadCount).toBe(2))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				disputeNewAmount1: '250',
				disputeNewAmount2: '45',
				disputeTokenToSwap: 'token2',
				stateHash: editedStateHash,
			}))
		})

		await act(async () => {
			staleTokenAccess.resolve([
				{ result: 500n, status: 'success' },
				{ result: 500n, status: 'success' },
				{ result: 500n, status: 'success' },
				{ result: 500n, status: 'success' },
			])
			await disputePromise
		})

		expect(disputeOracleReport).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).openOracleFeedback?.status.tone).toBe('success')
	})
})
