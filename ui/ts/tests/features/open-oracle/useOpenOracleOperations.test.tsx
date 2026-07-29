/// <reference types="bun-types" />

import { waitFor } from '../../testUtils/queries'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
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
const STATE_HASH = '0x1111111111111111111111111111111111111111111111111111111111111111'

type OpenOracleApprovalTestCase = {
	action: 'approveToken1' | 'approveToken2'
	allowanceKey: 'token1Approval' | 'token2Approval'
	changedContributionMessage: string
	currentAllowance: bigint
	disputeNewAmount1: string
	disputeNewAmount2: string
	disputeTokenToSwap: 'token1' | 'token2'
	requiredAmount: bigint
	token: 'token1' | 'token2'
	tokenLabel: 'base token' | 'quote token'
	underRequiredAmount: bigint
}

const OPEN_ORACLE_APPROVAL_TEST_CASES = [
	{
		action: 'approveToken1',
		allowanceKey: 'token1Approval',
		changedContributionMessage: 'The required base token approval changed',
		currentAllowance: 100n,
		disputeNewAmount1: '101',
		disputeNewAmount2: '25',
		disputeTokenToSwap: 'token1',
		requiredAmount: 201n,
		token: 'token1',
		tokenLabel: 'base token',
		underRequiredAmount: 150n,
	},
	{
		action: 'approveToken2',
		allowanceKey: 'token2Approval',
		changedContributionMessage: 'The required quote token approval changed',
		currentAllowance: 25n,
		disputeNewAmount1: '101',
		disputeNewAmount2: '26',
		disputeTokenToSwap: 'token2',
		requiredAmount: 51n,
		token: 'token2',
		tokenLabel: 'quote token',
		underRequiredAmount: 30n,
	},
] satisfies ReadonlyArray<OpenOracleApprovalTestCase>

type TestTokenAccessReadResult = { error: Error; status: 'failure' } | { result: bigint; status: 'success' }

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
		token1Decimals: 0,
		token1Symbol: 'REP',
		token2: TOKEN2_ADDRESS,
		token2Decimals: 0,
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
		loadOpenOracleReportDetails: async () => {
			throw new Error('loadOpenOracleReportDetails should not be called in this test')
		},
		loadOpenOracleWithdrawableBalances: async () => ({ eth: 0n, token1: 0n, token2: 0n }),
		readOptionalMulticall: mock(async () => [
			{ result: 100n, status: 'success' as const },
			{ result: 25n, status: 'success' as const },
			{ result: 100n, status: 'success' as const },
			{ result: 25n, status: 'success' as const },
		]),
		settleOracleReport: async () => {
			throw new Error('settleOracleReport should not be called in this test')
		},
		withdrawOpenOracleBalance: async () => {
			throw new Error('withdrawOpenOracleBalance should not be called in this test')
		},
		...overrides,
	}
}

function createHarness(dependencies: UseOpenOracleOperationsDependencies<TestOpenOracleWriteClient>, onRender: (state: UseOpenOracleOperationsState) => void, connected = true, parameterOverrides: Partial<Parameters<typeof useOpenOracleOperations>[0]> = {}) {
	return function OpenOracleOperationsHarness() {
		const state = useOpenOracleOperations(
			{
				accountAddress: connected ? WALLET_ADDRESS : undefined,
				enabled: true,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				...parameterOverrides,
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

function createTokenAccessReadResults({ token1Allowance = 100n, token2Allowance = 25n, unavailableToken }: { token1Allowance?: bigint; token2Allowance?: bigint; unavailableToken?: 'token1' | 'token2' | undefined } = {}): TestTokenAccessReadResult[] {
	const createAllowanceResult = (token: 'token1' | 'token2', allowance: bigint): TestTokenAccessReadResult => (token === unavailableToken ? { error: new Error(`${token} allowance RPC unavailable`), status: 'failure' } : { result: allowance, status: 'success' })
	return [createAllowanceResult('token1', token1Allowance), createAllowanceResult('token2', token2Allowance), { result: 1_000n, status: 'success' }, { result: 1_000n, status: 'success' }]
}

function setOpenOracleApprovalForm(state: UseOpenOracleOperationsState, testCase: OpenOracleApprovalTestCase) {
	state.setOpenOracleForm(current => ({
		...current,
		disputeNewAmount1: testCase.disputeNewAmount1,
		disputeNewAmount2: testCase.disputeNewAmount2,
		disputeTokenToSwap: testCase.disputeTokenToSwap,
	}))
}

async function invokeOpenOracleApproval(state: UseOpenOracleOperationsState, action: OpenOracleApprovalTestCase['action'], amount?: bigint) {
	if (action === 'approveToken1') {
		await state.approveToken1(amount)
		return
	}
	await state.approveToken2(amount)
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

	test('uses consistent Open Oracle capitalization in disconnected-wallet recovery', async () => {
		const dependencies = createOpenOracleOperationsDependencies()
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(
			dependencies,
			state => {
				hookState = state
			},
			false,
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).approveToken1(1n)
		})

		expect(requireHookState(hookState).openOracleFeedback?.status.detail).toBe('Connect a wallet before operating Open Oracle')
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

	test('clears stale details for a direct replacement load and ignores it after the selection is cleared', async () => {
		const secondReportId = 2n
		const secondReportLoad = createDeferred<OpenOracleReportDetails>()
		const dependencies = createOpenOracleOperationsDependencies({
			loadOpenOracleReportDetails: mock(async (_openOracleAddress: Address, reportId: bigint) => {
				if (reportId === REPORT_ID) return createOpenOracleReportDetails()
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

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		expect(requireHookState(hookState).openOracleReportDetails?.reportId).toBe(REPORT_ID)

		let replacementLoadPromise = Promise.resolve()
		await act(() => {
			replacementLoadPromise = requireHookState(hookState).loadOracleReport(secondReportId.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleReportLookupState).toBe('loading'))
		expect(requireHookState(hookState).openOracleForm.reportId).toBe(secondReportId.toString())
		expect(requireHookState(hookState).openOracleReportDetails).toBeUndefined()

		await act(() => {
			requireHookState(hookState).setOpenOracleForm(current => ({ ...current, reportId: '' }))
		})
		expect(requireHookState(hookState).openOracleReportLookupState).toBe('unknown')

		await act(async () => {
			secondReportLoad.resolve(createOpenOracleReportDetails({ reportId: secondReportId }))
			await replacementLoadPromise
		})
		expect(requireHookState(hookState).openOracleForm.reportId).toBe('')
		expect(requireHookState(hookState).openOracleReportDetails).toBeUndefined()
		expect(requireHookState(hookState).openOracleReportLookupState).toBe('unknown')
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

	test('approval preflight blocks a report that settled after it was loaded', async () => {
		const loadedReport = createOpenOracleReportDetails({
			currentReporter: getAddress('0x00000000000000000000000000000000000000dd'),
			reportTimestamp: 1n,
			settlementTime: 100n,
		})
		const settledReport = createOpenOracleReportDetails({
			...loadedReport,
			isDistributed: true,
		})
		let reportLoadCount = 0
		const approveErc20 = mock(async () => ({
			action: 'approveToken1' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d8' as const,
		}))
		const dependencies = createOpenOracleOperationsDependencies({
			approveErc20,
			loadOpenOracleReportDetails: mock(async () => {
				reportLoadCount += 1
				return reportLoadCount === 1 ? loadedReport : settledReport
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
			await requireHookState(hookState).approveToken1(1n)
		})

		expect(approveErc20).not.toHaveBeenCalled()
		expect(reportLoadCount).toBe(2)
		expect(requireHookState(hookState).openOracleFeedback?.status.detail).toContain('only available while disputing')
	})

	test('approval preflight derives the required amount from refreshed report details', async () => {
		const loadedReport = createOpenOracleReportDetails({
			currentReporter: getAddress('0x00000000000000000000000000000000000000dd'),
			reportTimestamp: 1n,
			settlementTime: 100n,
		})
		const refreshedReport = createOpenOracleReportDetails({
			...loadedReport,
			feePercentage: 1_000_000n,
		})
		let reportLoadCount = 0
		const approveErc20 = mock(async (_client: TestOpenOracleWriteClient, _tokenAddress: Address, _spenderAddress: Address, _amount: bigint, _action: 'approveToken1' | 'approveToken2') => ({
			action: 'approveToken1' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d9' as const,
		}))
		const dependencies = createOpenOracleOperationsDependencies({
			approveErc20,
			loadOpenOracleReportDetails: mock(async () => {
				reportLoadCount += 1
				return reportLoadCount === 1 ? loadedReport : refreshedReport
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
		await act(() => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				disputeNewAmount1: '101',
				disputeNewAmount2: '25',
				disputeTokenToSwap: 'token1',
			}))
		})
		await act(async () => {
			await requireHookState(hookState).approveToken1()
		})

		expect(approveErc20).toHaveBeenCalledTimes(1)
		expect(approveErc20.mock.calls[0]?.[3]).toBe(211n)
	})

	test('approval preflight blocks a refreshed dispute direction change even when the contribution is unchanged', async () => {
		const loadedReport = createOpenOracleReportDetails({
			currentReporter: getAddress('0x00000000000000000000000000000000000000dd'),
			reportTimestamp: 1n,
			settlementTime: 100n,
		})
		const refreshedReport = createOpenOracleReportDetails({
			...loadedReport,
			currentAmount2: 24n,
		})
		let reportLoadCount = 0
		const approveErc20 = mock(async () => ({
			action: 'approveToken1' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000da' as const,
		}))
		const dependencies = createOpenOracleOperationsDependencies({
			approveErc20,
			loadOpenOracleReportDetails: mock(async () => {
				reportLoadCount += 1
				return reportLoadCount === 1 ? loadedReport : refreshedReport
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
		await act(() => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				disputeNewAmount1: '101',
				disputeNewAmount2: '25',
				disputeTokenToSwap: 'token1',
			}))
		})
		await act(async () => {
			await requireHookState(hookState).approveToken1(201n)
		})

		expect(approveErc20).not.toHaveBeenCalled()
		expect(reportLoadCount).toBe(2)
		expect(requireHookState(hookState).openOracleFeedback?.status.detail).toContain('would swap out WETH, not REP')
	})

	for (const approvalCase of OPEN_ORACLE_APPROVAL_TEST_CASES) {
		test(`approval preflight blocks unavailable refreshed ${approvalCase.tokenLabel} allowance`, async () => {
			const reportDetails = createOpenOracleReportDetails({
				currentReporter: getAddress('0x00000000000000000000000000000000000000dd'),
				reportTimestamp: 1n,
				settlementTime: 100n,
			})
			let tokenAccessLoadCount = 0
			const approveErc20 = mock(async () => ({
				action: approvalCase.action,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000db' as const,
			}))
			const dependencies = createOpenOracleOperationsDependencies({
				approveErc20,
				loadOpenOracleReportDetails: mock(async () => reportDetails),
				readOptionalMulticall: mock(async () => {
					tokenAccessLoadCount += 1
					return createTokenAccessReadResults({
						unavailableToken: tokenAccessLoadCount === 1 ? undefined : approvalCase.token,
					})
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
			await waitFor(() => expect(requireHookState(hookState).openOracleTokenAccessState[approvalCase.allowanceKey].value).toBe(approvalCase.currentAllowance))
			await act(() => {
				setOpenOracleApprovalForm(requireHookState(hookState), approvalCase)
			})
			await act(async () => {
				await invokeOpenOracleApproval(requireHookState(hookState), approvalCase.action)
			})

			expect(approveErc20).not.toHaveBeenCalled()
			expect(tokenAccessLoadCount).toBe(2)
			expect(requireHookState(hookState).openOracleFeedback?.status.detail).toContain(`Unable to verify ${approvalCase.tokenLabel} approval before submitting this approval`)
			expect(requireHookState(hookState).openOracleFeedback?.status.detail).toContain('allowance RPC unavailable')
		})

		test(`approval preflight blocks a changed explicit ${approvalCase.tokenLabel} contribution`, async () => {
			const loadedReport = createOpenOracleReportDetails({
				currentReporter: getAddress('0x00000000000000000000000000000000000000dd'),
				reportTimestamp: 1n,
				settlementTime: 100n,
			})
			const refreshedReport = createOpenOracleReportDetails({
				...loadedReport,
				feePercentage: 1_000_000n,
			})
			let reportLoadCount = 0
			const approveErc20 = mock(async () => ({
				action: approvalCase.action,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000dc' as const,
			}))
			const dependencies = createOpenOracleOperationsDependencies({
				approveErc20,
				loadOpenOracleReportDetails: mock(async () => {
					reportLoadCount += 1
					return reportLoadCount === 1 ? loadedReport : refreshedReport
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
			await act(() => {
				setOpenOracleApprovalForm(requireHookState(hookState), approvalCase)
			})
			await act(async () => {
				await invokeOpenOracleApproval(requireHookState(hookState), approvalCase.action, approvalCase.requiredAmount)
			})

			expect(approveErc20).not.toHaveBeenCalled()
			expect(reportLoadCount).toBe(2)
			expect(requireHookState(hookState).openOracleFeedback?.status.detail).toContain(approvalCase.changedContributionMessage)
		})

		test(`approval preflight blocks a refreshed ${approvalCase.tokenLabel} allowance that became sufficient`, async () => {
			const reportDetails = createOpenOracleReportDetails({
				currentReporter: getAddress('0x00000000000000000000000000000000000000dd'),
				reportTimestamp: 1n,
				settlementTime: 100n,
			})
			let tokenAccessLoadCount = 0
			const approveErc20 = mock(async () => ({
				action: approvalCase.action,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000dd' as const,
			}))
			const dependencies = createOpenOracleOperationsDependencies({
				approveErc20,
				loadOpenOracleReportDetails: mock(async () => reportDetails),
				readOptionalMulticall: mock(async () => {
					tokenAccessLoadCount += 1
					return createTokenAccessReadResults({
						token1Allowance: approvalCase.token === 'token1' && tokenAccessLoadCount > 1 ? approvalCase.requiredAmount : 100n,
						token2Allowance: approvalCase.token === 'token2' && tokenAccessLoadCount > 1 ? approvalCase.requiredAmount : 25n,
					})
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
			await waitFor(() => expect(requireHookState(hookState).openOracleTokenAccessState[approvalCase.allowanceKey].value).toBe(approvalCase.currentAllowance))
			await act(() => {
				setOpenOracleApprovalForm(requireHookState(hookState), approvalCase)
			})
			await act(async () => {
				await invokeOpenOracleApproval(requireHookState(hookState), approvalCase.action, approvalCase.requiredAmount)
			})

			expect(approveErc20).not.toHaveBeenCalled()
			expect(tokenAccessLoadCount).toBe(2)
			expect(requireHookState(hookState).openOracleFeedback?.status.detail).toContain('already sufficient')
		})

		for (const rejectionCase of [
			{
				amount: approvalCase.currentAllowance,
				expectedMessage: `The ${approvalCase.tokenLabel} approval must increase the current allowance`,
				name: 'non-increasing explicit approval',
			},
			{
				amount: approvalCase.underRequiredAmount,
				expectedMessage: `The ${approvalCase.tokenLabel} approval must cover the refreshed dispute requirement`,
				name: 'under-required explicit approval',
			},
		]) {
			test(`approval preflight blocks ${rejectionCase.name} for the ${approvalCase.tokenLabel}`, async () => {
				const reportDetails = createOpenOracleReportDetails({
					currentReporter: getAddress('0x00000000000000000000000000000000000000dd'),
					reportTimestamp: 1n,
					settlementTime: 100n,
				})
				const approveErc20 = mock(async () => ({
					action: approvalCase.action,
					hash: '0x00000000000000000000000000000000000000000000000000000000000000de' as const,
				}))
				const dependencies = createOpenOracleOperationsDependencies({
					approveErc20,
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
				await waitFor(() => expect(requireHookState(hookState).openOracleTokenAccessState[approvalCase.allowanceKey].value).toBe(approvalCase.currentAllowance))
				await act(() => {
					setOpenOracleApprovalForm(requireHookState(hookState), approvalCase)
				})
				await act(async () => {
					await invokeOpenOracleApproval(requireHookState(hookState), approvalCase.action, rejectionCase.amount)
				})

				expect(approveErc20).not.toHaveBeenCalled()
				expect(requireHookState(hookState).openOracleFeedback?.status.detail).toContain(rejectionCase.expectedMessage)
			})
		}
	}

	test('approval preflight blocks a quote token approval that is no longer required after refresh', async () => {
		const loadedReport = createOpenOracleReportDetails({
			currentAmount2: 25n,
			currentReporter: getAddress('0x00000000000000000000000000000000000000dd'),
			escalationHalt: 200n,
			multiplier: 200n,
			reportTimestamp: 1n,
			settlementTime: 100n,
		})
		const refreshedReport = createOpenOracleReportDetails({
			...loadedReport,
			currentAmount2: 30n,
		})
		let reportLoadCount = 0
		const approveErc20 = mock(async () => ({
			action: 'approveToken2' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000df' as const,
		}))
		const dependencies = createOpenOracleOperationsDependencies({
			approveErc20,
			loadOpenOracleReportDetails: mock(async () => {
				reportLoadCount += 1
				return reportLoadCount === 1 ? loadedReport : refreshedReport
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
		await act(() => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				disputeNewAmount1: '200',
				disputeNewAmount2: '30',
				disputeTokenToSwap: 'token1',
			}))
		})
		await act(async () => {
			await requireHookState(hookState).approveToken2()
		})

		expect(approveErc20).not.toHaveBeenCalled()
		expect(reportLoadCount).toBe(2)
		expect(requireHookState(hookState).openOracleFeedback?.status.detail).toContain('No quote token approval is required for the refreshed report')
	})

	test('approval failures use base and quote token terminology', async () => {
		const dependencies = createOpenOracleOperationsDependencies({
			loadOpenOracleReportDetails: mock(async () =>
				createOpenOracleReportDetails({
					currentReporter: getAddress('0x00000000000000000000000000000000000000dd'),
					reportTimestamp: 1n,
					settlementTime: 100n,
				}),
			),
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
			await requireHookState(hookState).approveToken1(1n)
		})
		expect(requireHookState(hookState).openOracleFeedback?.status.title).toBe('Base token approval failed')

		await act(async () => {
			await requireHookState(hookState).approveToken2(1n)
		})
		expect(requireHookState(hookState).openOracleFeedback?.status.title).toBe('Quote token approval failed')
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

	test('keeps a failed post-settlement balance withdrawal visible and retryable', async () => {
		const settledReport = createOpenOracleReportDetails({
			currentReporter: WALLET_ADDRESS,
			isDistributed: true,
			reportTimestamp: 1n,
			settlementTimestamp: 11n,
		})
		const loadOpenOracleWithdrawableBalances = mock(async () => ({ eth: 7n, token1: 100n, token2: 25n }))
		let withdrawalAttempts = 0
		const withdrawOpenOracleBalance = mock(async () => {
			withdrawalAttempts += 1
			if (withdrawalAttempts === 1) throw new Error('wallet rejected withdrawal')
			return {
				action: 'withdrawBalance' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000e1' as const,
			}
		})
		const dependencies = createOpenOracleOperationsDependencies({
			loadOpenOracleReportDetails: async () => settledReport,
			loadOpenOracleWithdrawableBalances,
			withdrawOpenOracleBalance,
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
		await waitFor(() => expect(requireHookState(hookState).openOracleWithdrawableBalances).toEqual({ eth: 7n, token1: 100n, token2: 25n }))

		await act(async () => {
			await requireHookState(hookState).withdrawBalance('token1', 100n)
		})
		expect(requireHookState(hookState).openOracleFeedback?.status.tone).toBe('error')
		expect(requireHookState(hookState).openOracleWithdrawableBalances?.token1).toBe(100n)

		await act(async () => {
			await requireHookState(hookState).withdrawBalance('token1', 100n)
		})
		expect(withdrawOpenOracleBalance).toHaveBeenCalledTimes(2)
		expect(requireHookState(hookState).openOracleFeedback?.status.tone).toBe('success')
		expect(loadOpenOracleWithdrawableBalances.mock.calls.length).toBeGreaterThanOrEqual(2)
	})

	test('requires withdrawal reconfirmation when the reviewed balance changes', async () => {
		const settledReport = createOpenOracleReportDetails({
			currentReporter: WALLET_ADDRESS,
			isDistributed: true,
			reportTimestamp: 1n,
			settlementTimestamp: 11n,
		})
		let currentBalances = { eth: 7n, token1: 100n, token2: 25n }
		const preflightBalanceRefresh = createDeferred<typeof currentBalances>()
		let deferBalanceRefresh = false
		const loadOpenOracleWithdrawableBalances = mock(async () => (deferBalanceRefresh ? await preflightBalanceRefresh.promise : currentBalances))
		const withdrawOpenOracleBalance = mock(async (_client: unknown, _oracleAddress: Address, _token: Address, amount: bigint) => {
			expect(amount).toBe(125n)
			currentBalances = { ...currentBalances, token1: 0n }
			return {
				action: 'withdrawBalance' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000e2' as const,
			}
		})
		const dependencies = createOpenOracleOperationsDependencies({
			loadOpenOracleReportDetails: async () => settledReport,
			loadOpenOracleWithdrawableBalances,
			withdrawOpenOracleBalance,
		})
		const onTransactionFailed = mock(() => undefined)
		const onTransactionRequested = mock(() => undefined)
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(
			dependencies,
			state => {
				hookState = state
			},
			true,
			{ onTransactionFailed, onTransactionRequested },
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleWithdrawableBalances?.token1).toBe(100n))

		currentBalances = { ...currentBalances, token1: 125n }
		deferBalanceRefresh = true
		let withdrawalPromise = Promise.resolve()
		await act(() => {
			withdrawalPromise = requireHookState(hookState).withdrawBalance('token1', 100n)
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleWithdrawalBalanceChecking).toBe(true))
		const balanceLoadCount = loadOpenOracleWithdrawableBalances.mock.calls.length
		await act(async () => {
			await requireHookState(hookState).withdrawBalance('token1', 100n)
		})
		expect(loadOpenOracleWithdrawableBalances).toHaveBeenCalledTimes(balanceLoadCount)
		await act(async () => {
			preflightBalanceRefresh.resolve(currentBalances)
			await withdrawalPromise
		})
		deferBalanceRefresh = false

		expect(withdrawOpenOracleBalance).not.toHaveBeenCalled()
		expect(requireHookState(hookState).openOracleWithdrawableBalances?.token1).toBe(125n)
		expect(requireHookState(hookState).openOracleWithdrawalReviewMessage).toEqual({
			balance: 'token1',
			message: 'Your withdrawable REP balance changed. Review the updated amount and confirm again',
		})
		expect(requireHookState(hookState).openOracleActiveWithdrawalBalance).toBeUndefined()
		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(onTransactionFailed).not.toHaveBeenCalled()

		await act(async () => {
			await requireHookState(hookState).withdrawBalance('token1', 125n)
		})

		expect(withdrawOpenOracleBalance).toHaveBeenCalledTimes(1)
		expect(onTransactionRequested).toHaveBeenCalledTimes(1)
		expect(onTransactionFailed).not.toHaveBeenCalled()
		expect(requireHookState(hookState).openOracleWithdrawalReviewMessage).toBeUndefined()
		expect(requireHookState(hookState).openOracleFeedback?.status.tone).toBe('success')
	})

	test('cancels an obsolete withdrawal preflight and reserves other Oracle actions while it is current', async () => {
		const settleableReport = createOpenOracleReportDetails({
			currentReporter: WALLET_ADDRESS,
			currentTime: 12n,
			reportTimestamp: 1n,
			settlementTime: 10n,
		})
		const balances = { eth: 7n, token1: 100n, token2: 25n }
		const deferredBalanceRefresh = createDeferred<typeof balances>()
		let deferBalanceRefresh = false
		const loadOpenOracleWithdrawableBalances = mock(async () => (deferBalanceRefresh ? await deferredBalanceRefresh.promise : balances))
		const settleOracleReport = mock(async () => ({
			action: 'settle' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000e3' as const,
		}))
		const withdrawOpenOracleBalance = mock(async () => ({
			action: 'withdrawBalance' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000e4' as const,
		}))
		const dependencies = createOpenOracleOperationsDependencies({
			loadOpenOracleReportDetails: async () => settleableReport,
			loadOpenOracleWithdrawableBalances,
			settleOracleReport,
			withdrawOpenOracleBalance,
		})
		const onTransactionRequested = mock(() => undefined)
		const onReportSettled = mock(() => undefined)
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(
			dependencies,
			state => {
				hookState = state
			},
			true,
			{ onReportSettled, onTransactionRequested },
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleWithdrawableBalances?.token1).toBe(100n))

		deferBalanceRefresh = true
		let withdrawalPromise = Promise.resolve()
		await act(() => {
			withdrawalPromise = requireHookState(hookState).withdrawBalance('token1', 100n)
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleWithdrawalBalanceChecking).toBe(true))

		await act(async () => {
			await requireHookState(hookState).settleReport()
		})
		expect(settleOracleReport).not.toHaveBeenCalled()
		expect(onTransactionRequested).not.toHaveBeenCalled()

		await act(() => {
			requireHookState(hookState).cancelWithdrawalBalanceCheck()
		})
		expect(requireHookState(hookState).openOracleWithdrawalBalanceChecking).toBe(false)

		let settlementPromise = Promise.resolve()
		await act(() => {
			settlementPromise = requireHookState(hookState).settleReport()
		})
		await waitFor(() => expect(settleOracleReport).toHaveBeenCalledTimes(1))

		await act(async () => {
			deferredBalanceRefresh.resolve(balances)
			await Promise.all([withdrawalPromise, settlementPromise])
		})

		expect(withdrawOpenOracleBalance).not.toHaveBeenCalled()
		expect(settleOracleReport).toHaveBeenCalledTimes(1)
		expect(onReportSettled).toHaveBeenCalledTimes(1)
		expect(onTransactionRequested).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).openOracleActiveAction).toBeUndefined()
		expect(requireHookState(hookState).openOracleActiveWithdrawalBalance).toBeUndefined()
	})

	test('silently discards a withdrawal preflight when its enabled context changes before effects flush', async () => {
		const settledReport = createOpenOracleReportDetails({
			currentReporter: WALLET_ADDRESS,
			isDistributed: true,
			reportTimestamp: 1n,
			settlementTimestamp: 11n,
		})
		const initialBalances = { eth: 7n, token1: 100n, token2: 25n }
		const changedBalances = { ...initialBalances, token1: 125n }
		const deferredBalanceRefresh = createDeferred<typeof changedBalances>()
		let deferBalanceRefresh = false
		const loadOpenOracleWithdrawableBalances = mock(async () => (deferBalanceRefresh ? await deferredBalanceRefresh.promise : initialBalances))
		const withdrawOpenOracleBalance = mock(async () => ({
			action: 'withdrawBalance' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000e5' as const,
		}))
		const dependencies = createOpenOracleOperationsDependencies({
			loadOpenOracleReportDetails: async () => settledReport,
			loadOpenOracleWithdrawableBalances,
			withdrawOpenOracleBalance,
		})
		const onTransactionRequested = mock(() => undefined)
		let hookState: UseOpenOracleOperationsState | undefined
		const ContextHarness = ({ enabled }: { enabled: boolean }) => {
			const state = useOpenOracleOperations(
				{
					accountAddress: WALLET_ADDRESS,
					enabled,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
				},
				dependencies,
			)
			hookState = state
			return <div />
		}
		const renderedComponent = await renderIntoDocument(<ContextHarness enabled />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleWithdrawableBalances?.token1).toBe(100n))

		deferBalanceRefresh = true
		let withdrawalPromise = Promise.resolve()
		await act(() => {
			withdrawalPromise = requireHookState(hookState).withdrawBalance('token1', 100n)
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleWithdrawalBalanceChecking).toBe(true))

		await act(async () => {
			render(<ContextHarness enabled={false} />, renderedComponent.container)
			deferredBalanceRefresh.resolve(changedBalances)
			await withdrawalPromise
		})

		expect(requireHookState(hookState).openOracleWithdrawableBalances?.token1).toBe(100n)
		expect(requireHookState(hookState).openOracleWithdrawalReviewMessage).toBeUndefined()
		expect(requireHookState(hookState).openOracleActiveWithdrawalBalance).toBeUndefined()
		expect(withdrawOpenOracleBalance).not.toHaveBeenCalled()
		expect(onTransactionRequested).not.toHaveBeenCalled()
	})

	test('silently discards a withdrawal preflight when the selected report changes before it resolves', async () => {
		const settledReport = createOpenOracleReportDetails({
			currentReporter: WALLET_ADDRESS,
			isDistributed: true,
			reportTimestamp: 1n,
			settlementTimestamp: 11n,
		})
		const initialBalances = { eth: 7n, token1: 100n, token2: 25n }
		const changedBalances = { ...initialBalances, token1: 125n }
		const deferredBalanceRefresh = createDeferred<typeof changedBalances>()
		let deferBalanceRefresh = false
		const loadOpenOracleWithdrawableBalances = mock(async () => (deferBalanceRefresh ? await deferredBalanceRefresh.promise : initialBalances))
		const withdrawOpenOracleBalance = mock(async () => ({
			action: 'withdrawBalance' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000e6' as const,
		}))
		const dependencies = createOpenOracleOperationsDependencies({
			loadOpenOracleReportDetails: async () => settledReport,
			loadOpenOracleWithdrawableBalances,
			withdrawOpenOracleBalance,
		})
		const onTransactionRequested = mock(() => undefined)
		const observedReviewMessages: Array<UseOpenOracleOperationsState['openOracleWithdrawalReviewMessage']> = []
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(
			dependencies,
			state => {
				hookState = state
				observedReviewMessages.push(state.openOracleWithdrawalReviewMessage)
			},
			true,
			{ onTransactionRequested },
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadOracleReport(REPORT_ID.toString())
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleWithdrawableBalances?.token1).toBe(100n))

		deferBalanceRefresh = true
		let withdrawalPromise = Promise.resolve()
		await act(() => {
			withdrawalPromise = requireHookState(hookState).withdrawBalance('token1', 100n)
		})
		await waitFor(() => expect(requireHookState(hookState).openOracleWithdrawalBalanceChecking).toBe(true))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({ ...current, reportId: '2' }))
			deferredBalanceRefresh.resolve(changedBalances)
			await withdrawalPromise
		})

		expect(observedReviewMessages.every(message => message === undefined)).toBe(true)
		expect(requireHookState(hookState).openOracleActiveWithdrawalBalance).toBeUndefined()
		expect(withdrawOpenOracleBalance).not.toHaveBeenCalled()
		expect(onTransactionRequested).not.toHaveBeenCalled()
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
				disputeNewAmount2: '20',
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

	test('disputeReport rejects a direction changed by the forced report reload before refreshing token access', async () => {
		const initialReportDetails = createOpenOracleReportDetails({
			currentAmount1: 149n,
			currentAmount2: 25n,
			currentReporter: WALLET_ADDRESS,
			initialReporter: WALLET_ADDRESS,
			reportTimestamp: 5n,
		})
		const refreshedReportDetails = createOpenOracleReportDetails({
			...initialReportDetails,
			currentAmount2: 10n,
		})
		let reportLoadCount = 0
		const readOptionalMulticall = mock(async () => [
			{ result: 500n, status: 'success' as const },
			{ result: 500n, status: 'success' as const },
			{ result: 500n, status: 'success' as const },
			{ result: 500n, status: 'success' as const },
		])
		const disputeOracleReport = mock(async () => ({
			action: 'dispute' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000d7' as const,
		}))
		const dependencies = createOpenOracleOperationsDependencies({
			disputeOracleReport,
			loadOpenOracleReportDetails: mock(async () => {
				reportLoadCount += 1
				return reportLoadCount === 1 ? initialReportDetails : refreshedReportDetails
			}),
			readOptionalMulticall,
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
		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.currentAmount2).toBe(initialReportDetails.currentAmount2))
		await waitFor(() => expect(readOptionalMulticall).toHaveBeenCalledTimes(1))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				disputeNewAmount1: '150',
				disputeNewAmount2: '20',
				disputeTokenToSwap: 'token1',
				reportId: REPORT_ID.toString(),
				stateHash: STATE_HASH,
			}))
		})

		const tokenAccessLoadsBeforeDispute = readOptionalMulticall.mock.calls.length

		await act(async () => {
			await requireHookState(hookState).disputeReport()
		})

		expect(requireHookState(hookState).openOracleFeedback?.status.detail).toBe('These amounts would swap out WETH, not REP. Select WETH or change the proposed price')
		expect(readOptionalMulticall).toHaveBeenCalledTimes(tokenAccessLoadsBeforeDispute)
		expect(disputeOracleReport).not.toHaveBeenCalled()
	})

	test('disputeReport submits the state hash from the forced report reload', async () => {
		const refreshedStateHash = '0x2222222222222222222222222222222222222222222222222222222222222222'
		const initialReportDetails = createOpenOracleReportDetails({
			currentAmount1: 149n,
			currentAmount2: 25n,
			currentReporter: WALLET_ADDRESS,
			initialReporter: WALLET_ADDRESS,
			reportTimestamp: 5n,
			stateHash: STATE_HASH,
		})
		const refreshedReportDetails = createOpenOracleReportDetails({
			...initialReportDetails,
			currentAmount2: 24n,
			stateHash: refreshedStateHash,
		})
		let reportLoadCount = 0
		let submittedStateHash: string | undefined
		const disputeOracleReport = mock(async (_client: unknown, _openOracleAddress: Address, _reportId: bigint, _tokenToSwap: Address, _newAmount1: bigint, _newAmount2: bigint, _currentAmount2: bigint, stateHash: string) => {
			submittedStateHash = stateHash
			return {
				action: 'dispute' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000d8' as const,
			}
		})
		const dependencies = createOpenOracleOperationsDependencies({
			disputeOracleReport,
			loadOpenOracleReportDetails: mock(async () => {
				reportLoadCount += 1
				return reportLoadCount === 1 ? initialReportDetails : refreshedReportDetails
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
		await waitFor(() => expect(requireHookState(hookState).openOracleReportDetails?.stateHash).toBe(STATE_HASH))

		await act(async () => {
			requireHookState(hookState).setOpenOracleForm(current => ({
				...current,
				disputeNewAmount1: '150',
				disputeNewAmount2: '20',
				disputeTokenToSwap: 'token1',
				reportId: REPORT_ID.toString(),
				stateHash: STATE_HASH,
			}))
		})

		await act(async () => {
			await requireHookState(hookState).disputeReport()
		})

		expect(disputeOracleReport).toHaveBeenCalledTimes(1)
		expect(submittedStateHash).toBe(refreshedStateHash)
	})

	test('scales decimal dispute inputs before calling the protocol boundary', async () => {
		const tokenUnits = 10n ** 18n
		const reportDetails = createOpenOracleReportDetails({
			currentAmount1: tokenUnits,
			currentAmount2: 5n * tokenUnits,
			currentReporter: getAddress('0x00000000000000000000000000000000000000cc'),
			escalationHalt: 2n * tokenUnits,
			initialReporter: zeroAddress,
			multiplier: 20_000n,
			reportTimestamp: 5n,
			token1Decimals: 18,
			token2Decimals: 18,
		})
		const readOptionalMulticall = mock(async () => [
			{ result: 100n * tokenUnits, status: 'success' as const },
			{ result: 100n * tokenUnits, status: 'success' as const },
			{ result: 100n * tokenUnits, status: 'success' as const },
			{ result: 100n * tokenUnits, status: 'success' as const },
		])
		const disputeOracleReport = mock(async (_client: unknown, _oracleAddress: Address, _reportId: bigint, _tokenToSwap: Address, newAmount1: bigint, newAmount2: bigint) => {
			expect(newAmount1).toBe(2n * tokenUnits)
			expect(newAmount2).toBe(75n * 10n ** 17n)
			return {
				action: 'dispute' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000d3' as const,
			}
		})
		const dependencies = createOpenOracleOperationsDependencies({
			disputeOracleReport,
			loadOpenOracleReportDetails: mock(async () => reportDetails),
			readOptionalMulticall,
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
				disputeNewAmount1: '2',
				disputeNewAmount2: '7.5',
				disputeTokenToSwap: 'token1',
				reportId: REPORT_ID.toString(),
				stateHash: STATE_HASH,
			}))
		})
		await act(async () => {
			await requireHookState(hookState).disputeReport()
		})

		expect(disputeOracleReport).toHaveBeenCalledTimes(1)
	})

	test('createOpenOracleGame snapshots the submitted create form before decimals resolve', async () => {
		const token1Decimals = createDeferred<number>()
		const createOpenOracleReportInstance = mock(async (_client: unknown, submission: { exactToken1Report: bigint; initialToken2Amount: bigint; token1Address: Address; token2Address: Address }) => {
			expect(submission.exactToken1Report).toBe(10n * 10n ** 18n)
			expect(submission.initialToken2Amount).toBe(5n * 10n ** 18n)
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
				disputeDelay: '0',
				exactToken1Report: '10',
				initialToken2Amount: '5',
				settlementTime: '1',
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
			}))
		})

		await act(async () => {
			token1Decimals.resolve(18)
			await createPromise
		})

		expect(createOpenOracleReportInstance).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).openOracleFeedback?.status.tone).toBe('success')
	})

	test('does not attach a stale token contract error after its address changes', async () => {
		const editedToken1Address = getAddress('0x00000000000000000000000000000000000000d1')
		const token1Decimals = createDeferred<number>()
		const token2Decimals = createDeferred<number>()
		const onTransactionRequested = mock(() => undefined)
		const createOpenOracleReportInstance = mock(async () => {
			throw new Error('createOpenOracleReportInstance should not be called')
		})
		const dependencies = createOpenOracleOperationsDependencies({
			createConnectedReadClient: mock(() => ({
				getBalance: mock(async () => 5n * 10n ** 18n),
				getBlockNumber: mock(async () => 123n),
				readContract: mock(async parameters => await (parameters.address === TOKEN1_ADDRESS ? token1Decimals.promise : token2Decimals.promise)),
			})),
			createOpenOracleReportInstance,
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(
			dependencies,
			state => {
				hookState = state
			},
			true,
			{ onTransactionRequested },
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setOpenOracleCreateForm(current => ({
				...current,
				disputeDelay: '0',
				exactToken1Report: '10',
				initialToken2Amount: '5',
				settlementTime: '1',
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
				token1Address: editedToken1Address,
			}))
		})
		await act(async () => {
			token1Decimals.reject(new Error('base token contract function returned no data'))
			token2Decimals.reject(new Error('quote token contract function returned no data'))
			await createPromise
		})

		expect(requireHookState(hookState).openOracleCreateFieldErrors).toEqual({
			token2Address: 'Quote token address is not a readable ERC-20 contract.',
		})
		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(createOpenOracleReportInstance).not.toHaveBeenCalled()
	})

	test('createOpenOracleGame reports invalid decimals with user-facing token terminology', async () => {
		const dependencies = createOpenOracleOperationsDependencies({
			createConnectedReadClient: mock(() => ({
				getBalance: mock(async () => 5n * 10n ** 18n),
				getBlockNumber: mock(async () => 123n),
				readContract: mock(async () => 256),
			})),
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
				disputeDelay: '0',
				exactToken1Report: '10',
				initialToken2Amount: '5',
				settlementTime: '1',
				token1Address: TOKEN1_ADDRESS,
				token2Address: TOKEN2_ADDRESS,
			}))
			await requireHookState(hookState).createOpenOracleGame()
		})

		expect(requireHookState(hookState).openOracleCreateFieldErrors.token1Address).toBe('Base token address is not a readable ERC-20 contract.')
		expect(requireHookState(hookState).openOracleFeedback).toBeUndefined()
	})

	test('keeps unreadable token contract preflight out of the transaction workflow', async () => {
		const onTransactionRequested = mock(() => undefined)
		const createOpenOracleReportInstance = mock(async () => {
			throw new Error('createOpenOracleReportInstance should not be called')
		})
		const dependencies = createOpenOracleOperationsDependencies({
			createConnectedReadClient: mock(() => ({
				getBalance: mock(async () => 5n * 10n ** 18n),
				getBlockNumber: mock(async () => 123n),
				readContract: mock(async parameters => {
					if (parameters.address === TOKEN1_ADDRESS) throw new Error('contract function returned no data')
					return 18
				}),
			})),
			createOpenOracleReportInstance,
		})
		let hookState: UseOpenOracleOperationsState | undefined
		const Harness = createHarness(
			dependencies,
			state => {
				hookState = state
			},
			true,
			{ onTransactionRequested },
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setOpenOracleCreateForm(current => ({
				...current,
				disputeDelay: '0',
				exactToken1Report: '10',
				initialToken2Amount: '5',
				settlementTime: '1',
				token1Address: TOKEN1_ADDRESS,
				token2Address: TOKEN2_ADDRESS,
			}))
			await requireHookState(hookState).createOpenOracleGame()
		})

		expect(requireHookState(hookState).openOracleCreateFieldErrors).toEqual({
			token1Address: 'Base token address is not a readable ERC-20 contract.',
		})
		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(createOpenOracleReportInstance).not.toHaveBeenCalled()
	})

	test('rethrows unexpected token contract preflight failures', async () => {
		const unexpectedError = new TypeError('unexpected token dependency failure')
		const dependencies = createOpenOracleOperationsDependencies({
			createConnectedReadClient: mock(() => ({
				getBalance: mock(async () => 5n * 10n ** 18n),
				getBlockNumber: mock(async () => 123n),
				readContract: mock(async () => {
					throw unexpectedError
				}),
			})),
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
				disputeDelay: '0',
				exactToken1Report: '10',
				initialToken2Amount: '5',
				settlementTime: '1',
				token1Address: TOKEN1_ADDRESS,
				token2Address: TOKEN2_ADDRESS,
			}))
		})

		await expect(
			act(async () => {
				await requireHookState(hookState).createOpenOracleGame()
			}),
		).rejects.toBe(unexpectedError)
		expect(requireHookState(hookState).openOracleCreateFieldErrors).toEqual({})
	})

	test('disputeReport snapshots the submitted dispute inputs before token access refresh resolves', async () => {
		const editedStateHash = '0x3333333333333333333333333333333333333333333333333333333333333333'
		const staleTokenAccess = createDeferred<[{ result: bigint; status: 'success' }, { result: bigint; status: 'success' }, { result: bigint; status: 'success' }, { result: bigint; status: 'success' }]>()
		let tokenAccessLoadCount = 0
		const disputeOracleReport = mock(async (_client: unknown, _oracleAddress: Address, reportId: bigint, tokenToSwap: Address, amount1: bigint, amount2: bigint, currentAmount2: bigint, stateHash: string) => {
			expect(reportId).toBe(REPORT_ID)
			expect(tokenToSwap).toBe(TOKEN1_ADDRESS)
			expect(amount1).toBe(150n)
			expect(amount2).toBe(20n)
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
				disputeNewAmount2: '20',
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
