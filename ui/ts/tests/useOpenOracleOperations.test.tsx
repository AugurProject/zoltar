/// <reference types="bun-types" />

import { waitFor } from './testUtils/queries'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress } from 'viem'
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
})
