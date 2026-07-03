/// <reference types="bun-types" />

import { waitFor } from './testUtils/queries'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, type Address } from '@zoltar/shared/ethereum'
import type { OpenOracleReportDetails } from '../types/contracts.js'
import { installActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { createFakeBackend } from './testUtils/fakeBackend.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

type UseOpenOracleOperations = typeof import('../hooks/useOpenOracleOperations.js')['useOpenOracleOperations']
type UseOpenOracleOperationsState = ReturnType<UseOpenOracleOperations>

const OPEN_ORACLE_ADDRESS = getAddress('0x00000000000000000000000000000000000000aa')
const REPORT_ID = 1n
const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000bb')
const TOKEN1_ADDRESS = getAddress('0x00000000000000000000000000000000000000c1')
const TOKEN2_ADDRESS = getAddress('0x00000000000000000000000000000000000000c2')
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
		price: 4n,
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

function createHarness(useOpenOracleOperations: UseOpenOracleOperations, onRender: (state: UseOpenOracleOperationsState) => void) {
	return function OpenOracleOperationsHarness() {
		const state = useOpenOracleOperations({
			accountAddress: WALLET_ADDRESS,
			enabled: true,
			onTransactionFinished: () => undefined,
			onTransactionPresented: () => undefined,
			onTransactionRequested: () => undefined,
			onTransactionSubmitted: () => undefined,
			refreshState: async () => undefined,
		})

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

	test('submitInitialReport reloads token access after a successful write', async () => {
		const reportDetails = createOpenOracleReportDetails()
		const readOptionalMulticall = mock(async () => [
			{ result: 100n, status: 'success' },
			{ result: 25n, status: 'success' },
			{ result: 100n, status: 'success' },
			{ result: 25n, status: 'success' },
		])
		const submitInitialOracleReport = mock(async () => ({
			action: 'submitInitialReport',
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d1',
		}))

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			createOpenOracleReportInstance: mock(async () => {
				throw new Error('createOpenOracleReportInstance should not be called in this test')
			}),
			disputeOracleReport: mock(async () => {
				throw new Error('disputeOracleReport should not be called in this test')
			}),
			getOpenOracleAddress: () => OPEN_ORACLE_ADDRESS,
			loadOpenOracleReportDetails: mock(async () => reportDetails),
			readOptionalMulticall,
			settleOracleReport: mock(async () => {
				throw new Error('settleOracleReport should not be called in this test')
			}),
			submitInitialOracleReport,
			wrapWeth: mock(async () => {
				throw new Error('wrapWeth should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))
		mock.module('../lib/openOracle.js', () => ({
			deriveOpenOracleDisputeSubmissionDetails: () => ({
				blockMessage: undefined,
				canSubmit: true,
				expectedNewAmount1: 100n,
				token1ContributionAmount: 0n,
				token1Decimals: 18,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
				token2ContributionAmount: 0n,
				token2Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
			}),
			deriveOpenOracleInitialReportSubmissionDetails: () => ({
				amount1: 100n,
				amount2: 25n,
				blockMessage: undefined,
				canSubmit: true,
				hasWethWrapAction: false,
				priceSource: 'Manual override',
				priceSourceUrl: undefined,
				requiredWethWrapAmount: 0n,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 100n, shortfall: 0n, targetAmount: 100n },
				token1Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 25n, shortfall: 0n, targetAmount: 25n },
				token2Decimals: 18,
				wrapRequiredWethMessage: undefined,
			}),
			formatOpenOracleDisputeWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOracleInitialReportWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOraclePriceInput: (price: bigint) => price.toString(),
			formatOpenOracleSettleWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			getOpenOracleCreateGuardMessage: () => undefined,
			getOpenOracleDisputeAvailability: () => ({ canAct: true, message: undefined }),
			getOpenOracleSelectedReportActionMode: (details: OpenOracleReportDetails) => (details.currentReporter === zeroAddress || details.reportTimestamp === 0n ? 'initial-report' : 'dispute'),
			getOpenOracleSettleAvailability: () => ({ canAct: true, message: undefined }),
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 4n,
				priceSource: 'MOCK',
				priceSourceUrl: undefined,
				status: 'success',
				token2Amount: 25n,
			})),
		}))

		const { useOpenOracleOperations } = await import(`../hooks/useOpenOracleOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(useOpenOracleOperations, state => {
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
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d7',
		}))

		mock.module('../contracts.js', () => ({
			approveErc20,
			createOpenOracleReportInstance: mock(async () => {
				throw new Error('createOpenOracleReportInstance should not be called in this test')
			}),
			disputeOracleReport: mock(async () => {
				throw new Error('disputeOracleReport should not be called in this test')
			}),
			getOpenOracleAddress: () => OPEN_ORACLE_ADDRESS,
			loadOpenOracleReportDetails: mock(async (_client: unknown, _oracleAddress: string, reportId: bigint) => {
				if (reportId === REPORT_ID) return firstReportDetails
				if (reportId === secondReportId) return createOpenOracleReportDetails({ reportId: secondReportId })
				throw new Error(`Unexpected report ${reportId.toString()}`)
			}),
			readOptionalMulticall: mock(async () => {
				tokenAccessLoadCount += 1
				return [
					{ result: 100n, status: 'success' },
					{ result: 25n, status: 'success' },
					{ result: 100n, status: 'success' },
					{ result: 25n, status: 'success' },
				]
			}),
			settleOracleReport: mock(async () => {
				throw new Error('settleOracleReport should not be called in this test')
			}),
			submitInitialOracleReport: mock(async () => {
				throw new Error('submitInitialOracleReport should not be called in this test')
			}),
			wrapWeth: mock(async () => {
				throw new Error('wrapWeth should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))
		mock.module('../lib/openOracle.js', () => ({
			deriveOpenOracleDisputeSubmissionDetails: () => ({
				blockMessage: undefined,
				canSubmit: true,
				expectedNewAmount1: 100n,
				token1ContributionAmount: 0n,
				token1Decimals: 18,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
				token2ContributionAmount: 0n,
				token2Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
			}),
			deriveOpenOracleInitialReportSubmissionDetails: () => ({
				amount1: 100n,
				amount2: 25n,
				blockMessage: undefined,
				canSubmit: true,
				hasWethWrapAction: false,
				priceSource: 'Manual override',
				priceSourceUrl: undefined,
				requiredWethWrapAmount: 0n,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 100n, shortfall: 0n, targetAmount: 100n },
				token1Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 25n, shortfall: 0n, targetAmount: 25n },
				token2Decimals: 18,
				wrapRequiredWethMessage: undefined,
			}),
			formatOpenOracleDisputeWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOracleInitialReportWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOraclePriceInput: (price: bigint) => price.toString(),
			formatOpenOracleSettleWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			getOpenOracleCreateGuardMessage: () => undefined,
			getOpenOracleDisputeAvailability: () => ({ canAct: true, message: undefined }),
			getOpenOracleSelectedReportActionMode: () => 'initial-report',
			getOpenOracleSettleAvailability: () => ({ canAct: true, message: undefined }),
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 4n,
				priceSource: 'MOCK',
				priceSourceUrl: undefined,
				status: 'success',
				token2Amount: 25n,
			})),
		}))

		const { useOpenOracleOperations } = await import(`../hooks/useOpenOracleOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(useOpenOracleOperations, state => {
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
			currentReporter: WALLET_ADDRESS,
			reportId: REPORT_ID,
			reportTimestamp: 1n,
		})
		const secondReportDetails = createOpenOracleReportDetails({
			currentReporter: WALLET_ADDRESS,
			reportId: secondReportId,
			reportTimestamp: 1n,
		})
		const staleRefresh = createDeferred<OpenOracleReportDetails>()
		let firstReportLoadCount = 0
		const loadOpenOracleReportDetails = mock(async (_client: unknown, _oracleAddress: string, reportId: bigint) => {
			if (reportId === REPORT_ID) {
				firstReportLoadCount += 1
				if (firstReportLoadCount <= 2) return firstReportDetails
				return await staleRefresh.promise
			}
			if (reportId === secondReportId) return secondReportDetails
			throw new Error(`Unexpected report ${reportId.toString()}`)
		})
		const readOptionalMulticall = mock(async () => [
			{ result: 100n, status: 'success' },
			{ result: 25n, status: 'success' },
			{ result: 100n, status: 'success' },
			{ result: 25n, status: 'success' },
		])
		const settleOracleReport = mock(async () => ({
			action: 'settle' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d2',
		}))

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			createOpenOracleReportInstance: mock(async () => {
				throw new Error('createOpenOracleReportInstance should not be called in this test')
			}),
			disputeOracleReport: mock(async () => {
				throw new Error('disputeOracleReport should not be called in this test')
			}),
			getOpenOracleAddress: () => OPEN_ORACLE_ADDRESS,
			loadOpenOracleReportDetails,
			readOptionalMulticall,
			settleOracleReport,
			submitInitialOracleReport: mock(async () => {
				throw new Error('submitInitialOracleReport should not be called in this test')
			}),
			wrapWeth: mock(async () => {
				throw new Error('wrapWeth should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))
		mock.module('../lib/openOracle.js', () => ({
			deriveOpenOracleDisputeSubmissionDetails: () => ({
				blockMessage: undefined,
				canSubmit: true,
				expectedNewAmount1: 100n,
				token1ContributionAmount: 0n,
				token1Decimals: 18,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
				token2ContributionAmount: 0n,
				token2Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
			}),
			deriveOpenOracleInitialReportSubmissionDetails: () => ({
				amount1: 100n,
				amount2: 25n,
				blockMessage: undefined,
				canSubmit: true,
				hasWethWrapAction: false,
				priceSource: 'Manual override',
				priceSourceUrl: undefined,
				requiredWethWrapAmount: 0n,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 100n, shortfall: 0n, targetAmount: 100n },
				token1Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 25n, shortfall: 0n, targetAmount: 25n },
				token2Decimals: 18,
				wrapRequiredWethMessage: undefined,
			}),
			formatOpenOracleDisputeWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOracleInitialReportWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOraclePriceInput: (price: bigint) => price.toString(),
			formatOpenOracleSettleWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			getOpenOracleCreateGuardMessage: () => undefined,
			getOpenOracleDisputeAvailability: () => ({ canAct: true, message: undefined }),
			getOpenOracleSelectedReportActionMode: () => 'settle',
			getOpenOracleSettleAvailability: () => ({ canAct: true, message: undefined }),
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 4n,
				priceSource: 'MOCK',
				priceSourceUrl: undefined,
				status: 'success',
				token2Amount: 25n,
			})),
		}))

		const { useOpenOracleOperations } = await import(`../hooks/useOpenOracleOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(useOpenOracleOperations, state => {
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
			currentReporter: WALLET_ADDRESS,
			reportId: REPORT_ID,
			reportTimestamp: 1n,
		})
		const secondReportDetails = createOpenOracleReportDetails({
			currentReporter: WALLET_ADDRESS,
			reportId: secondReportId,
			reportTimestamp: 1n,
		})
		const stalePreflightReload = createDeferred<OpenOracleReportDetails>()
		let firstReportLoadCount = 0
		const loadOpenOracleReportDetails = mock(async (_client: unknown, _oracleAddress: string, reportId: bigint) => {
			if (reportId === REPORT_ID) {
				firstReportLoadCount += 1
				if (firstReportLoadCount === 1) return firstReportDetails
				return await stalePreflightReload.promise
			}
			if (reportId === secondReportId) return secondReportDetails
			throw new Error(`Unexpected report ${reportId.toString()}`)
		})
		const readOptionalMulticall = mock(async () => [
			{ result: 100n, status: 'success' },
			{ result: 25n, status: 'success' },
			{ result: 100n, status: 'success' },
			{ result: 25n, status: 'success' },
		])
		const settleOracleReport = mock(async () => ({
			action: 'settle' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d9',
		}))

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			createOpenOracleReportInstance: mock(async () => {
				throw new Error('createOpenOracleReportInstance should not be called in this test')
			}),
			disputeOracleReport: mock(async () => {
				throw new Error('disputeOracleReport should not be called in this test')
			}),
			getOpenOracleAddress: () => OPEN_ORACLE_ADDRESS,
			loadOpenOracleReportDetails,
			readOptionalMulticall,
			settleOracleReport,
			submitInitialOracleReport: mock(async () => {
				throw new Error('submitInitialOracleReport should not be called in this test')
			}),
			wrapWeth: mock(async () => {
				throw new Error('wrapWeth should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))
		mock.module('../lib/openOracle.js', () => ({
			deriveOpenOracleDisputeSubmissionDetails: () => ({
				blockMessage: undefined,
				canSubmit: true,
				expectedNewAmount1: 100n,
				token1ContributionAmount: 0n,
				token1Decimals: 18,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
				token2ContributionAmount: 0n,
				token2Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
			}),
			deriveOpenOracleInitialReportSubmissionDetails: () => ({
				amount1: 100n,
				amount2: 25n,
				blockMessage: undefined,
				canSubmit: true,
				hasWethWrapAction: false,
				priceSource: 'Manual override',
				priceSourceUrl: undefined,
				requiredWethWrapAmount: 0n,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 100n, shortfall: 0n, targetAmount: 100n },
				token1Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 25n, shortfall: 0n, targetAmount: 25n },
				token2Decimals: 18,
				wrapRequiredWethMessage: undefined,
			}),
			formatOpenOracleDisputeWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOracleInitialReportWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOraclePriceInput: (price: bigint) => price.toString(),
			formatOpenOracleSettleWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			getOpenOracleCreateGuardMessage: () => undefined,
			getOpenOracleDisputeAvailability: () => ({ canAct: true, message: undefined }),
			getOpenOracleSelectedReportActionMode: () => 'settle',
			getOpenOracleSettleAvailability: () => ({ canAct: true, message: undefined }),
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 4n,
				priceSource: 'MOCK',
				priceSourceUrl: undefined,
				status: 'success',
				token2Amount: 25n,
			})),
		}))

		const { useOpenOracleOperations } = await import(`../hooks/useOpenOracleOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(useOpenOracleOperations, state => {
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
		expect(requireHookState(hookState).openOracleFeedback?.status.detail).toBe('Selected report changed. Review the current report and try again.')
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
		}

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			createOpenOracleReportInstance: mock(async () => {
				throw new Error('createOpenOracleReportInstance should not be called in this test')
			}),
			disputeOracleReport: mock(async () => {
				throw new Error('disputeOracleReport should not be called in this test')
			}),
			getOpenOracleAddress: () => OPEN_ORACLE_ADDRESS,
			loadOpenOracleReportDetails: mock(async (_client: unknown, _oracleAddress: string, reportId: bigint) => {
				if (reportId === REPORT_ID) return firstReportDetails
				if (reportId === secondReportId) return secondReportDetails
				throw new Error(`Unexpected report ${reportId.toString()}`)
			}),
			readOptionalMulticall: mock(async () => {
				tokenAccessLoadCount += 1
				if (tokenAccessLoadCount === 1) return await staleTokenAccess.promise
				return [
					{ result: 200n, status: 'success' },
					{ result: 35n, status: 'success' },
					{ result: 200n, status: 'success' },
					{ result: 35n, status: 'success' },
				]
			}),
			settleOracleReport: mock(async () => {
				throw new Error('settleOracleReport should not be called in this test')
			}),
			submitInitialOracleReport: mock(async () => {
				throw new Error('submitInitialOracleReport should not be called in this test')
			}),
			wrapWeth: mock(async () => {
				throw new Error('wrapWeth should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => readClient),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))
		mock.module('../lib/openOracle.js', () => ({
			deriveOpenOracleDisputeSubmissionDetails: () => ({
				blockMessage: undefined,
				canSubmit: true,
				expectedNewAmount1: 100n,
				token1ContributionAmount: 0n,
				token1Decimals: 18,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
				token2ContributionAmount: 0n,
				token2Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
			}),
			deriveOpenOracleInitialReportSubmissionDetails: () => ({
				amount1: 100n,
				amount2: 25n,
				blockMessage: undefined,
				canSubmit: true,
				hasWethWrapAction: false,
				priceSource: 'Manual override',
				priceSourceUrl: undefined,
				requiredWethWrapAmount: 0n,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 100n, shortfall: 0n, targetAmount: 100n },
				token1Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 25n, shortfall: 0n, targetAmount: 25n },
				token2Decimals: 18,
				wrapRequiredWethMessage: undefined,
			}),
			formatOpenOracleDisputeWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOracleInitialReportWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOraclePriceInput: (price: bigint) => price.toString(),
			formatOpenOracleSettleWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			getOpenOracleCreateGuardMessage: () => undefined,
			getOpenOracleDisputeAvailability: () => ({ canAct: true, message: undefined }),
			getOpenOracleSelectedReportActionMode: () => 'initial-report',
			getOpenOracleSettleAvailability: () => ({ canAct: true, message: undefined }),
			loadOpenOracleInitialReportPriceResult: mock(async () => {
				quoteLoadCount += 1
				if (quoteLoadCount === 1) return await staleQuote.promise
				return {
					price: 7n,
					priceSource: 'MOCK',
					priceSourceUrl: undefined,
					status: 'success',
					token2Amount: 35n,
				}
			}),
		}))

		const { useOpenOracleOperations } = await import(`../hooks/useOpenOracleOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(useOpenOracleOperations, state => {
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
				price: 4n,
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
				{ result: 100n, status: 'success' },
				{ result: 25n, status: 'success' },
				{ result: 100n, status: 'success' },
				{ result: 25n, status: 'success' },
			])
			const submitInitialOracleReport = mock(async (_client: unknown, _openOracleAddress: string, _reportId: bigint, _amount1: bigint, _amount2: bigint, _stateHash: string) => ({
				action: 'submitInitialReport',
				hash: '0x00000000000000000000000000000000000000000000000000000000000000d3',
			}))
			let quoteLoadCount = 0
			const loadOpenOracleInitialReportPriceResult = mock(async () => {
				quoteLoadCount += 1
				const refreshedQuote = quoteLoadCount > 1
				return {
					price: refreshedQuote ? 5n : 4n,
					priceSource: 'MOCK',
					priceSourceUrl: undefined,
					status: 'success',
					token2Amount: refreshedQuote ? 20n : 25n,
				}
			})

			mock.module('../contracts.js', () => ({
				approveErc20: mock(async () => {
					throw new Error('approveErc20 should not be called in this test')
				}),
				createOpenOracleReportInstance: mock(async () => {
					throw new Error('createOpenOracleReportInstance should not be called in this test')
				}),
				disputeOracleReport: mock(async () => {
					throw new Error('disputeOracleReport should not be called in this test')
				}),
				getOpenOracleAddress: () => OPEN_ORACLE_ADDRESS,
				loadOpenOracleReportDetails: mock(async () => reportDetails),
				readOptionalMulticall,
				settleOracleReport: mock(async () => {
					throw new Error('settleOracleReport should not be called in this test')
				}),
				submitInitialOracleReport,
				wrapWeth: mock(async () => {
					throw new Error('wrapWeth should not be called in this test')
				}),
			}))
			mock.module('../lib/clients.js', () => ({
				createConnectedReadClient: mock(() => ({ getBlockNumber: async () => 10n, kind: 'read-client' })),
				createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
			}))
			mock.module('../lib/openOracle.js', () => ({
				deriveOpenOracleDisputeSubmissionDetails: () => ({
					blockMessage: undefined,
					canSubmit: true,
					expectedNewAmount1: 100n,
					token1ContributionAmount: 0n,
					token1Decimals: 18,
					token1Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
					token2ContributionAmount: 0n,
					token2Decimals: 18,
					token2Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
				}),
				deriveOpenOracleInitialReportSubmissionDetails: (parameters: { priceInput: string }) => {
					const amount2 = parameters.priceInput.trim() === '5' ? 20n : 25n
					return {
						amount1: 100n,
						amount2,
						blockMessage: undefined,
						canSubmit: true,
						hasWethWrapAction: false,
						priceSource: parameters.priceInput.trim() === '5' ? 'MOCK' : 'Manual override',
						priceSourceUrl: undefined,
						requiredWethWrapAmount: 0n,
						token1Approval: { hasSufficientApproval: true, requiredAmount: 100n, shortfall: 0n, targetAmount: 100n },
						token1Decimals: 18,
						token2Approval: { hasSufficientApproval: true, requiredAmount: amount2, shortfall: 0n, targetAmount: amount2 },
						token2Decimals: 18,
						wrapRequiredWethMessage: undefined,
					}
				},
				formatOpenOracleDisputeWriteErrorMessage: (_error: unknown, fallbackMessage: string) => fallbackMessage,
				formatOpenOracleInitialReportWriteErrorMessage: (_error: unknown, fallbackMessage: string) => fallbackMessage,
				formatOpenOraclePriceInput: (price: bigint) => price.toString(),
				formatOpenOracleSettleWriteErrorMessage: (_error: unknown, fallbackMessage: string) => fallbackMessage,
				getOpenOracleCreateGuardMessage: () => undefined,
				getOpenOracleDisputeAvailability: () => ({ canAct: true, message: undefined }),
				getOpenOracleSelectedReportActionMode: (details: OpenOracleReportDetails) => (details.currentReporter === zeroAddress || details.reportTimestamp === 0n ? 'initial-report' : 'dispute'),
				getOpenOracleSettleAvailability: () => ({ canAct: true, message: undefined }),
				loadOpenOracleInitialReportPriceResult,
			}))

			const { useOpenOracleOperations } = await import(`../hooks/useOpenOracleOperations.js?case=${crypto.randomUUID()}`)
			let hookState: UseOpenOracleOperationsState | undefined
			const Harness = createHarness(useOpenOracleOperations, state => {
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
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d5',
		}))
		const readClient = {
			getBalance: mock(async () => 5n * 10n ** 18n),
			getBlockNumber: mock(async () => 123n),
		}

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			createOpenOracleReportInstance: mock(async () => {
				throw new Error('createOpenOracleReportInstance should not be called in this test')
			}),
			disputeOracleReport: mock(async () => {
				throw new Error('disputeOracleReport should not be called in this test')
			}),
			getOpenOracleAddress: () => OPEN_ORACLE_ADDRESS,
			loadOpenOracleReportDetails: mock(async (_client: unknown, _oracleAddress: string, reportId: bigint) => {
				if (reportId === REPORT_ID) return firstReportDetails
				if (reportId === secondReportId) return secondReportDetails
				throw new Error(`Unexpected report ${reportId.toString()}`)
			}),
			readOptionalMulticall: mock(async () => {
				tokenAccessLoadCount += 1
				if (tokenAccessLoadCount === 2) return await staleTokenAccess.promise
				return [
					{ result: 200n, status: 'success' },
					{ result: 35n, status: 'success' },
					{ result: 200n, status: 'success' },
					{ result: 35n, status: 'success' },
				]
			}),
			settleOracleReport: mock(async () => {
				throw new Error('settleOracleReport should not be called in this test')
			}),
			submitInitialOracleReport,
			wrapWeth: mock(async () => {
				throw new Error('wrapWeth should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => readClient),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))
		mock.module('../lib/openOracle.js', () => ({
			deriveOpenOracleDisputeSubmissionDetails: () => ({
				blockMessage: undefined,
				canSubmit: true,
				expectedNewAmount1: 100n,
				token1ContributionAmount: 0n,
				token1Decimals: 18,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
				token2ContributionAmount: 0n,
				token2Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
			}),
			deriveOpenOracleInitialReportSubmissionDetails: () => ({
				amount1: 100n,
				amount2: 25n,
				blockMessage: undefined,
				canSubmit: true,
				hasWethWrapAction: false,
				priceSource: 'Manual override',
				priceSourceUrl: undefined,
				requiredWethWrapAmount: 0n,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 100n, shortfall: 0n, targetAmount: 100n },
				token1Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 25n, shortfall: 0n, targetAmount: 25n },
				token2Decimals: 18,
				wrapRequiredWethMessage: undefined,
			}),
			formatOpenOracleDisputeWriteErrorMessage: (_error: unknown, fallbackMessage: string) => fallbackMessage,
			formatOpenOracleInitialReportWriteErrorMessage: (_error: unknown, fallbackMessage: string) => fallbackMessage,
			formatOpenOraclePriceInput: (price: bigint) => price.toString(),
			formatOpenOracleSettleWriteErrorMessage: (_error: unknown, fallbackMessage: string) => fallbackMessage,
			getOpenOracleCreateGuardMessage: () => undefined,
			getOpenOracleDisputeAvailability: () => ({ canAct: true, message: undefined }),
			getOpenOracleSelectedReportActionMode: () => 'initial-report',
			getOpenOracleSettleAvailability: () => ({ canAct: true, message: undefined }),
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 7n,
				priceSource: 'MOCK',
				priceSourceUrl: undefined,
				status: 'success',
				token2Amount: 35n,
			})),
		}))

		const { useOpenOracleOperations } = await import(`../hooks/useOpenOracleOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(useOpenOracleOperations, state => {
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
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d6',
		}))
		const readClient = {
			getBalance: mock(async () => 5n * 10n ** 18n),
			getBlockNumber: mock(async () => 123n),
		}

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			createOpenOracleReportInstance: mock(async () => {
				throw new Error('createOpenOracleReportInstance should not be called in this test')
			}),
			disputeOracleReport: mock(async () => {
				throw new Error('disputeOracleReport should not be called in this test')
			}),
			getOpenOracleAddress: () => OPEN_ORACLE_ADDRESS,
			loadOpenOracleReportDetails: mock(async (_client: unknown, _oracleAddress: string, reportId: bigint) => {
				if (reportId === REPORT_ID) return firstReportDetails
				if (reportId === secondReportId) return secondReportDetails
				throw new Error(`Unexpected report ${reportId.toString()}`)
			}),
			readOptionalMulticall: mock(async () => {
				tokenAccessLoadCount += 1
				if (tokenAccessLoadCount === 2) return await staleTokenAccess.promise
				return [
					{ result: 200n, status: 'success' },
					{ result: 35n, status: 'success' },
					{ result: 200n, status: 'success' },
					{ result: 35n, status: 'success' },
				]
			}),
			settleOracleReport: mock(async () => {
				throw new Error('settleOracleReport should not be called in this test')
			}),
			submitInitialOracleReport: mock(async () => {
				throw new Error('submitInitialOracleReport should not be called in this test')
			}),
			wrapWeth,
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => readClient),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))
		mock.module('../lib/openOracle.js', () => ({
			deriveOpenOracleDisputeSubmissionDetails: () => ({
				blockMessage: undefined,
				canSubmit: true,
				expectedNewAmount1: 100n,
				token1ContributionAmount: 0n,
				token1Decimals: 18,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
				token2ContributionAmount: 0n,
				token2Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
			}),
			deriveOpenOracleInitialReportSubmissionDetails: () => ({
				amount1: 100n,
				amount2: 25n,
				blockMessage: undefined,
				canSubmit: true,
				canWrapRequiredWeth: true,
				hasWethWrapAction: true,
				priceSource: 'Manual override',
				priceSourceUrl: undefined,
				requiredWethWrapAmount: 1n * 10n ** 18n,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 100n, shortfall: 0n, targetAmount: 100n },
				token1Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 25n, shortfall: 0n, targetAmount: 25n },
				token2Decimals: 18,
				wrapRequiredWethMessage: undefined,
			}),
			formatOpenOracleDisputeWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOracleInitialReportWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOraclePriceInput: (price: bigint) => price.toString(),
			formatOpenOracleSettleWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			getOpenOracleCreateGuardMessage: () => undefined,
			getOpenOracleDisputeAvailability: () => ({ canAct: true, message: undefined }),
			getOpenOracleSelectedReportActionMode: () => 'initial-report',
			getOpenOracleSettleAvailability: () => ({ canAct: true, message: undefined }),
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 7n,
				priceSource: 'MOCK',
				priceSourceUrl: undefined,
				status: 'success',
				token2Amount: 35n,
			})),
		}))

		const { useOpenOracleOperations } = await import(`../hooks/useOpenOracleOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(useOpenOracleOperations, state => {
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
				{ result: 100n, status: 'success' },
				{ result: 25n, status: 'success' },
				{ result: 100n, status: 'success' },
				{ result: 25n, status: 'success' },
			])
			const submitInitialOracleReport = mock(async () => ({
				action: 'submitInitialReport',
				hash: '0x00000000000000000000000000000000000000000000000000000000000000d4',
			}))
			let quoteLoadCount = 0
			const loadOpenOracleInitialReportPriceResult = mock(async () => {
				quoteLoadCount += 1
				if (quoteLoadCount > 1) throw new Error('Stale quote RPC unavailable')
				return {
					price: 4n,
					priceSource: 'MOCK',
					priceSourceUrl: undefined,
					status: 'success',
					token2Amount: 25n,
				}
			})

			mock.module('../contracts.js', () => ({
				approveErc20: mock(async () => {
					throw new Error('approveErc20 should not be called in this test')
				}),
				createOpenOracleReportInstance: mock(async () => {
					throw new Error('createOpenOracleReportInstance should not be called in this test')
				}),
				disputeOracleReport: mock(async () => {
					throw new Error('disputeOracleReport should not be called in this test')
				}),
				getOpenOracleAddress: () => OPEN_ORACLE_ADDRESS,
				loadOpenOracleReportDetails: mock(async () => reportDetails),
				readOptionalMulticall,
				settleOracleReport: mock(async () => {
					throw new Error('settleOracleReport should not be called in this test')
				}),
				submitInitialOracleReport,
				wrapWeth: mock(async () => {
					throw new Error('wrapWeth should not be called in this test')
				}),
			}))
			mock.module('../lib/clients.js', () => ({
				createConnectedReadClient: mock(() => ({ getBlockNumber: async () => 10n, kind: 'read-client' })),
				createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
			}))
			mock.module('../lib/openOracle.js', () => ({
				deriveOpenOracleDisputeSubmissionDetails: () => ({
					blockMessage: undefined,
					canSubmit: true,
					expectedNewAmount1: 100n,
					token1ContributionAmount: 0n,
					token1Decimals: 18,
					token1Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
					token2ContributionAmount: 0n,
					token2Decimals: 18,
					token2Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
				}),
				deriveOpenOracleInitialReportSubmissionDetails: () => ({
					amount1: 100n,
					amount2: 25n,
					blockMessage: undefined,
					canSubmit: true,
					hasWethWrapAction: false,
					priceSource: 'MOCK',
					priceSourceUrl: undefined,
					requiredWethWrapAmount: 0n,
					token1Approval: { hasSufficientApproval: true, requiredAmount: 100n, shortfall: 0n, targetAmount: 100n },
					token1Decimals: 18,
					token2Approval: { hasSufficientApproval: true, requiredAmount: 25n, shortfall: 0n, targetAmount: 25n },
					token2Decimals: 18,
					wrapRequiredWethMessage: undefined,
				}),
				formatOpenOracleDisputeWriteErrorMessage: (_error: unknown, fallbackMessage: string) => fallbackMessage,
				formatOpenOracleInitialReportWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
				formatOpenOraclePriceInput: (price: bigint) => price.toString(),
				formatOpenOracleSettleWriteErrorMessage: (_error: unknown, fallbackMessage: string) => fallbackMessage,
				getOpenOracleCreateGuardMessage: () => undefined,
				getOpenOracleDisputeAvailability: () => ({ canAct: true, message: undefined }),
				getOpenOracleSelectedReportActionMode: (details: OpenOracleReportDetails) => (details.currentReporter === zeroAddress || details.reportTimestamp === 0n ? 'initial-report' : 'dispute'),
				getOpenOracleSettleAvailability: () => ({ canAct: true, message: undefined }),
				loadOpenOracleInitialReportPriceResult,
			}))

			const { useOpenOracleOperations } = await import(`../hooks/useOpenOracleOperations.js?case=${crypto.randomUUID()}`)
			let hookState: UseOpenOracleOperationsState | undefined
			const Harness = createHarness(useOpenOracleOperations, state => {
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
			expect(requireHookState(hookState).openOracleFeedback?.status.detail).toBe('Automatic price quote is stale and could not be refreshed. Refresh the quote or enter a manual price before submitting.')
			expect(submitInitialOracleReport).not.toHaveBeenCalled()
		} finally {
			Date.now = originalDateNow
		}
	})

	test('disputeReport blocks a stale token-access refresh after the selected report changes', async () => {
		const secondReportId = 2n
		const firstReportDetails = createOpenOracleReportDetails({
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
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d6',
		}))
		const readClient = {
			getBalance: mock(async () => 5n * 10n ** 18n),
			getBlockNumber: mock(async () => 123n),
		}

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			createOpenOracleReportInstance: mock(async () => {
				throw new Error('createOpenOracleReportInstance should not be called in this test')
			}),
			disputeOracleReport,
			getOpenOracleAddress: () => OPEN_ORACLE_ADDRESS,
			loadOpenOracleReportDetails: mock(async (_client: unknown, _oracleAddress: string, reportId: bigint) => {
				if (reportId === REPORT_ID) return firstReportDetails
				if (reportId === secondReportId) return secondReportDetails
				throw new Error(`Unexpected report ${reportId.toString()}`)
			}),
			readOptionalMulticall: mock(async () => {
				tokenAccessLoadCount += 1
				if (tokenAccessLoadCount === 2) return await staleTokenAccess.promise
				return [
					{ result: 200n, status: 'success' },
					{ result: 35n, status: 'success' },
					{ result: 200n, status: 'success' },
					{ result: 35n, status: 'success' },
				]
			}),
			settleOracleReport: mock(async () => {
				throw new Error('settleOracleReport should not be called in this test')
			}),
			submitInitialOracleReport: mock(async () => {
				throw new Error('submitInitialOracleReport should not be called in this test')
			}),
			wrapWeth: mock(async () => {
				throw new Error('wrapWeth should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => readClient),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))
		mock.module('../lib/openOracle.js', () => ({
			deriveOpenOracleDisputeSubmissionDetails: () => ({
				blockMessage: undefined,
				canSubmit: true,
				expectedNewAmount1: 100n,
				token1ContributionAmount: 0n,
				token1Decimals: 18,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
				token2ContributionAmount: 0n,
				token2Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
			}),
			deriveOpenOracleInitialReportSubmissionDetails: () => ({
				amount1: 100n,
				amount2: 25n,
				blockMessage: undefined,
				canSubmit: true,
				hasWethWrapAction: false,
				priceSource: 'Manual override',
				priceSourceUrl: undefined,
				requiredWethWrapAmount: 0n,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 100n, shortfall: 0n, targetAmount: 100n },
				token1Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 25n, shortfall: 0n, targetAmount: 25n },
				token2Decimals: 18,
				wrapRequiredWethMessage: undefined,
			}),
			formatOpenOracleDisputeWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOracleInitialReportWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOraclePriceInput: (price: bigint) => price.toString(),
			formatOpenOracleSettleWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			getOpenOracleCreateGuardMessage: () => undefined,
			getOpenOracleDisputeAvailability: () => ({ canAct: true, message: undefined }),
			getOpenOracleSelectedReportActionMode: () => 'dispute',
			getOpenOracleSettleAvailability: () => ({ canAct: true, message: undefined }),
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 7n,
				priceSource: 'MOCK',
				priceSourceUrl: undefined,
				status: 'success',
				token2Amount: 35n,
			})),
		}))

		const { useOpenOracleOperations } = await import(`../hooks/useOpenOracleOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(useOpenOracleOperations, state => {
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
			currentReporter: WALLET_ADDRESS,
			initialReporter: WALLET_ADDRESS,
			reportTimestamp: 5n,
		})
		const readOptionalMulticall = mock(async () => [
			{ result: 200n, status: 'success' },
			{ result: 50n, status: 'success' },
			{ result: 200n, status: 'success' },
			{ result: 50n, status: 'success' },
		])
		const disputeOracleReport = mock(async () => ({
			action: 'dispute',
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d2',
		}))

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			createOpenOracleReportInstance: mock(async () => {
				throw new Error('createOpenOracleReportInstance should not be called in this test')
			}),
			disputeOracleReport,
			getOpenOracleAddress: () => OPEN_ORACLE_ADDRESS,
			loadOpenOracleReportDetails: mock(async () => reportDetails),
			readOptionalMulticall,
			settleOracleReport: mock(async () => {
				throw new Error('settleOracleReport should not be called in this test')
			}),
			submitInitialOracleReport: mock(async () => {
				throw new Error('submitInitialOracleReport should not be called in this test')
			}),
			wrapWeth: mock(async () => {
				throw new Error('wrapWeth should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))
		mock.module('../lib/openOracle.js', () => ({
			deriveOpenOracleDisputeSubmissionDetails: () => ({
				blockMessage: undefined,
				canSubmit: true,
				expectedNewAmount1: 150n,
				token1ContributionAmount: 50n,
				token1Decimals: 18,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 50n, shortfall: 0n, targetAmount: 50n },
				token2ContributionAmount: 10n,
				token2Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 10n, shortfall: 0n, targetAmount: 10n },
			}),
			deriveOpenOracleInitialReportSubmissionDetails: () => ({
				amount1: 100n,
				amount2: 25n,
				blockMessage: undefined,
				canSubmit: true,
				hasWethWrapAction: false,
				priceSource: 'Manual override',
				priceSourceUrl: undefined,
				requiredWethWrapAmount: 0n,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 100n, shortfall: 0n, targetAmount: 100n },
				token1Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 25n, shortfall: 0n, targetAmount: 25n },
				token2Decimals: 18,
				wrapRequiredWethMessage: undefined,
			}),
			formatOpenOracleDisputeWriteErrorMessage: (_error: unknown, fallbackMessage: string) => fallbackMessage,
			formatOpenOracleInitialReportWriteErrorMessage: (_error: unknown, fallbackMessage: string) => fallbackMessage,
			formatOpenOraclePriceInput: (price: bigint) => price.toString(),
			formatOpenOracleSettleWriteErrorMessage: (_error: unknown, fallbackMessage: string) => fallbackMessage,
			getOpenOracleCreateGuardMessage: () => undefined,
			getOpenOracleDisputeAvailability: () => ({ canAct: true, message: undefined }),
			getOpenOracleSelectedReportActionMode: (details: OpenOracleReportDetails) => (details.currentReporter === zeroAddress || details.reportTimestamp === 0n ? 'initial-report' : 'dispute'),
			getOpenOracleSettleAvailability: () => ({ canAct: true, message: undefined }),
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 4n,
				priceSource: 'MOCK',
				priceSourceUrl: undefined,
				status: 'success',
				token2Amount: 25n,
			})),
		}))

		const { useOpenOracleOperations } = await import(`../hooks/useOpenOracleOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(useOpenOracleOperations, state => {
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
		const createOpenOracleReportInstance = mock(async (_client: unknown, submission: { exactToken1Report: string; token1Address: Address; token2Address: Address; token1Decimals: number }) => {
			expect(submission).toEqual({
				exactToken1Report: '10',
				token1Address: TOKEN1_ADDRESS,
				token1Decimals: 18,
				token2Address: TOKEN2_ADDRESS,
			})
			return {
				action: 'createReportInstance' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000e1',
			}
		})
		const actualOpenOracle = await import('../lib/openOracle.js')

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			createOpenOracleReportInstance,
			disputeOracleReport: mock(async () => {
				throw new Error('disputeOracleReport should not be called in this test')
			}),
			getOpenOracleAddress: () => OPEN_ORACLE_ADDRESS,
			loadOpenOracleReportDetails: mock(async () => {
				throw new Error('loadOpenOracleReportDetails should not be called in this test')
			}),
			readOptionalMulticall: mock(async () => {
				throw new Error('readOptionalMulticall should not be called in this test')
			}),
			settleOracleReport: mock(async () => {
				throw new Error('settleOracleReport should not be called in this test')
			}),
			submitInitialOracleReport: mock(async () => {
				throw new Error('submitInitialOracleReport should not be called in this test')
			}),
			wrapWeth: mock(async () => {
				throw new Error('wrapWeth should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({
				getBalance: mock(async () => 5n * 10n ** 18n),
				readContract: mock(async () => await token1Decimals.promise),
			})),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))
		mock.module('../lib/openOracle.js', () => ({
			...actualOpenOracle,
			getOpenOracleCreateGuardMessage: () => undefined,
			getOpenOracleCreateValidationMessage: () => undefined,
			parseOpenOracleCreateFormSubmission: ({ form, token1Decimals: currentToken1Decimals }: { form: { exactToken1Report: string; token1Address: Address; token2Address: Address }; token1Decimals: number }) => ({
				exactToken1Report: form.exactToken1Report,
				token1Address: form.token1Address,
				token1Decimals: currentToken1Decimals,
				token2Address: form.token2Address,
			}),
		}))

		const { useOpenOracleOperations } = await import(`../hooks/useOpenOracleOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(useOpenOracleOperations, state => {
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
				hash: '0x00000000000000000000000000000000000000000000000000000000000000e2',
			}
		})

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			createOpenOracleReportInstance: mock(async () => {
				throw new Error('createOpenOracleReportInstance should not be called in this test')
			}),
			disputeOracleReport: mock(async () => {
				throw new Error('disputeOracleReport should not be called in this test')
			}),
			getOpenOracleAddress: () => OPEN_ORACLE_ADDRESS,
			loadOpenOracleReportDetails: mock(async () => createOpenOracleReportDetails()),
			readOptionalMulticall: mock(async () => {
				tokenAccessLoadCount += 1
				if (tokenAccessLoadCount === 2) return await staleTokenAccess.promise
				return [
					{ result: 100n, status: 'success' },
					{ result: 25n, status: 'success' },
					{ result: 100n, status: 'success' },
					{ result: 25n, status: 'success' },
				]
			}),
			settleOracleReport: mock(async () => {
				throw new Error('settleOracleReport should not be called in this test')
			}),
			submitInitialOracleReport,
			wrapWeth: mock(async () => {
				throw new Error('wrapWeth should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ getBlockNumber: async () => 123n, kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))
		mock.module('../lib/openOracle.js', () => ({
			deriveOpenOracleDisputeSubmissionDetails: () => ({
				blockMessage: undefined,
				canSubmit: true,
				expectedNewAmount1: 100n,
				token1ContributionAmount: 0n,
				token1Decimals: 18,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
				token2ContributionAmount: 0n,
				token2Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
			}),
			deriveOpenOracleInitialReportSubmissionDetails: (parameters: { priceInput: string }) => ({
				amount1: 100n,
				amount2: parameters.priceInput.trim() === '4' ? 25n : 20n,
				blockMessage: undefined,
				canSubmit: true,
				hasWethWrapAction: false,
				priceSource: 'Manual override',
				priceSourceUrl: undefined,
				requiredWethWrapAmount: 0n,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 100n, shortfall: 0n, targetAmount: 100n },
				token1Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 25n, shortfall: 0n, targetAmount: 25n },
				token2Decimals: 18,
				wrapRequiredWethMessage: undefined,
			}),
			formatOpenOracleDisputeWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOracleInitialReportWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOraclePriceInput: (price: bigint) => price.toString(),
			formatOpenOracleSettleWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			getOpenOracleCreateGuardMessage: () => undefined,
			getOpenOracleCreateValidationMessage: () => undefined,
			getOpenOracleDisputeAvailability: () => ({ canAct: true, message: undefined }),
			getOpenOracleSelectedReportActionMode: () => 'initial-report',
			getOpenOracleSettleAvailability: () => ({ canAct: true, message: undefined }),
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 4n,
				priceSource: 'MOCK',
				priceSourceUrl: undefined,
				status: 'success',
				token2Amount: 25n,
			})),
			parseOpenOracleCreateFormSubmission: () => {
				throw new Error('parseOpenOracleCreateFormSubmission should not be called in this test')
			},
		}))

		const { useOpenOracleOperations } = await import(`../hooks/useOpenOracleOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(useOpenOracleOperations, state => {
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
			expect(amount).toBe(1n * 10n ** 18n)
			return {
				action: 'wrapWeth' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000e3',
			}
		})

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			createOpenOracleReportInstance: mock(async () => {
				throw new Error('createOpenOracleReportInstance should not be called in this test')
			}),
			disputeOracleReport: mock(async () => {
				throw new Error('disputeOracleReport should not be called in this test')
			}),
			getOpenOracleAddress: () => OPEN_ORACLE_ADDRESS,
			loadOpenOracleReportDetails: mock(async () => createOpenOracleReportDetails()),
			readOptionalMulticall: mock(async () => {
				tokenAccessLoadCount += 1
				if (tokenAccessLoadCount === 2) return await staleTokenAccess.promise
				return [
					{ result: 100n, status: 'success' },
					{ result: 25n, status: 'success' },
					{ result: 100n, status: 'success' },
					{ result: 25n, status: 'success' },
				]
			}),
			settleOracleReport: mock(async () => {
				throw new Error('settleOracleReport should not be called in this test')
			}),
			submitInitialOracleReport: mock(async () => {
				throw new Error('submitInitialOracleReport should not be called in this test')
			}),
			wrapWeth,
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ getBlockNumber: async () => 123n, kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))
		mock.module('../lib/openOracle.js', () => ({
			deriveOpenOracleDisputeSubmissionDetails: () => ({
				blockMessage: undefined,
				canSubmit: true,
				expectedNewAmount1: 100n,
				token1ContributionAmount: 0n,
				token1Decimals: 18,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
				token2ContributionAmount: 0n,
				token2Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 0n, shortfall: 0n, targetAmount: 0n },
			}),
			deriveOpenOracleInitialReportSubmissionDetails: (parameters: { priceInput: string }) => ({
				amount1: 100n,
				amount2: 25n,
				blockMessage: undefined,
				canSubmit: true,
				canWrapRequiredWeth: true,
				hasWethWrapAction: true,
				priceSource: 'Manual override',
				priceSourceUrl: undefined,
				requiredWethWrapAmount: parameters.priceInput.trim() === '4' ? 1n * 10n ** 18n : 2n * 10n ** 18n,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 100n, shortfall: 0n, targetAmount: 100n },
				token1Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 25n, shortfall: 0n, targetAmount: 25n },
				token2Decimals: 18,
				wrapRequiredWethMessage: undefined,
			}),
			formatOpenOracleDisputeWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOracleInitialReportWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOraclePriceInput: (price: bigint) => price.toString(),
			formatOpenOracleSettleWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			getOpenOracleCreateGuardMessage: () => undefined,
			getOpenOracleCreateValidationMessage: () => undefined,
			getOpenOracleDisputeAvailability: () => ({ canAct: true, message: undefined }),
			getOpenOracleSelectedReportActionMode: () => 'initial-report',
			getOpenOracleSettleAvailability: () => ({ canAct: true, message: undefined }),
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 4n,
				priceSource: 'MOCK',
				priceSourceUrl: undefined,
				status: 'success',
				token2Amount: 25n,
			})),
			parseOpenOracleCreateFormSubmission: () => {
				throw new Error('parseOpenOracleCreateFormSubmission should not be called in this test')
			},
		}))

		const { useOpenOracleOperations } = await import(`../hooks/useOpenOracleOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(useOpenOracleOperations, state => {
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
				{ result: 25n, status: 'success' },
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
				hash: '0x00000000000000000000000000000000000000000000000000000000000000e4',
			}
		})

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			createOpenOracleReportInstance: mock(async () => {
				throw new Error('createOpenOracleReportInstance should not be called in this test')
			}),
			disputeOracleReport,
			getOpenOracleAddress: () => OPEN_ORACLE_ADDRESS,
			loadOpenOracleReportDetails: mock(async () =>
				createOpenOracleReportDetails({
					currentReporter: WALLET_ADDRESS,
					reportTimestamp: 1n,
				}),
			),
			readOptionalMulticall: mock(async () => {
				tokenAccessLoadCount += 1
				if (tokenAccessLoadCount === 2) return await staleTokenAccess.promise
				return [
					{ result: 200n, status: 'success' },
					{ result: 35n, status: 'success' },
					{ result: 200n, status: 'success' },
					{ result: 35n, status: 'success' },
				]
			}),
			settleOracleReport: mock(async () => {
				throw new Error('settleOracleReport should not be called in this test')
			}),
			submitInitialOracleReport: mock(async () => {
				throw new Error('submitInitialOracleReport should not be called in this test')
			}),
			wrapWeth: mock(async () => {
				throw new Error('wrapWeth should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ getBlockNumber: async () => 123n, kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))
		mock.module('../lib/openOracle.js', () => ({
			deriveOpenOracleDisputeSubmissionDetails: (parameters: { disputeNewAmount1Input: string }) => ({
				blockMessage: undefined,
				canSubmit: true,
				expectedNewAmount1: parameters.disputeNewAmount1Input.trim() === '150' ? 150n : 250n,
				token1ContributionAmount: 50n,
				token1Decimals: 18,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 50n, shortfall: 0n, targetAmount: 50n },
				token2ContributionAmount: 10n,
				token2Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 10n, shortfall: 0n, targetAmount: 10n },
			}),
			deriveOpenOracleInitialReportSubmissionDetails: () => ({
				amount1: 100n,
				amount2: 25n,
				blockMessage: undefined,
				canSubmit: true,
				hasWethWrapAction: false,
				priceSource: 'Manual override',
				priceSourceUrl: undefined,
				requiredWethWrapAmount: 0n,
				token1Approval: { hasSufficientApproval: true, requiredAmount: 100n, shortfall: 0n, targetAmount: 100n },
				token1Decimals: 18,
				token2Approval: { hasSufficientApproval: true, requiredAmount: 25n, shortfall: 0n, targetAmount: 25n },
				token2Decimals: 18,
				wrapRequiredWethMessage: undefined,
			}),
			formatOpenOracleDisputeWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOracleInitialReportWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			formatOpenOraclePriceInput: (price: bigint) => price.toString(),
			formatOpenOracleSettleWriteErrorMessage: (error: unknown, fallbackMessage: string) => (error instanceof Error ? error.message : fallbackMessage),
			getOpenOracleCreateGuardMessage: () => undefined,
			getOpenOracleCreateValidationMessage: () => undefined,
			getOpenOracleDisputeAvailability: () => ({ canAct: true, message: undefined }),
			getOpenOracleSelectedReportActionMode: () => 'dispute',
			getOpenOracleSettleAvailability: () => ({ canAct: true, message: undefined }),
			loadOpenOracleInitialReportPriceResult: mock(async () => ({
				price: 4n,
				priceSource: 'MOCK',
				priceSourceUrl: undefined,
				status: 'success',
				token2Amount: 25n,
			})),
			parseOpenOracleCreateFormSubmission: () => {
				throw new Error('parseOpenOracleCreateFormSubmission should not be called in this test')
			},
		}))

		const { useOpenOracleOperations } = await import(`../hooks/useOpenOracleOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(useOpenOracleOperations, state => {
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
				{ result: 200n, status: 'success' },
				{ result: 35n, status: 'success' },
				{ result: 200n, status: 'success' },
				{ result: 35n, status: 'success' },
			])
			await disputePromise
		})

		expect(disputeOracleReport).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).openOracleFeedback?.status.tone).toBe('success')
	})
})
