/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { renderSelectedReportActionSection } from '../../../features/open-oracle/components/OpenOracleSection.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { deriveOpenOracleDisputeSubmissionDetails, type OpenOracleDisputeSubmissionDetails } from '../../../features/open-oracle/lib/openOracle.js'
import { getDefaultOpenOracleFormState } from '../../../features/markets/lib/marketForm.js'
import type { AccountState, OpenOracleFormState } from '../../../types/app.js'
import type { OpenOracleSectionProps } from '../../../features/types.js'
import type { OpenOracleReportDetails, OpenOracleReportSummaryPage } from '../../../types/contracts.js'
import { OpenOracleSection } from '../../../features/open-oracle/components/OpenOracleSection.js'
import { getDefaultOpenOracleCreateFormState } from '../../../features/markets/lib/marketForm.js'
import { createFakeBackend } from '../../testUtils/fakeBackend.js'
import { installActiveEnvironmentForTesting } from '../../../lib/activeEnvironment.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { fireEvent, within } from '../../testUtils/queries.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'

type VNodeLike = {
	props: Record<string, unknown>
	type: unknown
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isVNodeLike(value: unknown): value is VNodeLike {
	return isObjectRecord(value) && 'type' in value && 'props' in value && isObjectRecord(value['props'])
}

function visitTree(node: unknown, visitor: (vnode: VNodeLike) => void) {
	if (Array.isArray(node)) {
		for (const child of node) {
			visitTree(child, visitor)
		}
		return
	}

	if (!isVNodeLike(node)) return

	visitor(node)
	visitTree(node.props['children'], visitor)
}

function getTextContent(node: unknown): string {
	if (typeof node === 'string' || typeof node === 'number') return String(node)
	if (Array.isArray(node)) return node.map(child => getTextContent(child)).join('')
	if (!isVNodeLike(node)) return ''
	return getTextContent(node.props['children'])
}

function getButtonLikeLabel(vnode: VNodeLike) {
	if (vnode.type === 'button') return getTextContent(vnode.props['children']).trim()
	if (vnode.type !== TransactionActionButton) return undefined
	const idleLabel = vnode.props['idleLabel']
	return typeof idleLabel === 'string' ? idleLabel.trim() : undefined
}

function getButtonDisabled(vnode: VNodeLike) {
	if (vnode.type === 'button') return vnode.props['disabled'] === true
	if (vnode.type !== TransactionActionButton) return undefined
	const availability = vnode.props['availability']
	if (!isObjectRecord(availability)) return undefined
	return availability['disabled'] === true
}

function getButtonDisabledReason(vnode: VNodeLike) {
	if (vnode.type === 'button') {
		const title = vnode.props['title']
		return typeof title === 'string' ? title : undefined
	}
	if (vnode.type !== TransactionActionButton) return undefined
	const availability = vnode.props['availability']
	if (!isObjectRecord(availability)) return undefined
	const reason = availability['reason']
	return typeof reason === 'string' ? reason : undefined
}

function findButton(node: unknown, label: string) {
	let matchingButton: VNodeLike | undefined
	visitTree(node, vnode => {
		if (matchingButton !== undefined) return
		if (getButtonLikeLabel(vnode) === label) matchingButton = vnode
	})
	return matchingButton
}

function getSectionTitles(node: unknown) {
	const titles: string[] = []
	visitTree(node, vnode => {
		if (vnode.type !== SectionBlock) return
		const title = vnode.props['title']
		if (typeof title === 'string') titles.push(title)
	})
	return titles
}

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalance: 10n * 10n ** 18n,
		wethBalance: 5n * 10n ** 18n,
		...overrides,
	}
}

function createOpenOracleForm(overrides: Partial<OpenOracleFormState> = {}): OpenOracleFormState {
	return {
		...getDefaultOpenOracleFormState(),
		reportId: '7',
		stateHash: '0x1234000000000000000000000000000000000000000000000000000000000000',
		...overrides,
	}
}

function createOpenOracleReportDetails(overrides: Partial<OpenOracleReportDetails> = {}): OpenOracleReportDetails {
	return {
		callbackContract: zeroAddress,
		callbackGasLimit: 0,
		currentBlockNumber: 0n,
		currentAmount1: 0n,
		currentAmount2: 0n,
		currentReporter: zeroAddress,
		currentTime: 0n,
		disputeDelay: 3600n,
		disputeOccurred: false,
		escalationHalt: 5n * 10n ** 17n,
		exactToken1Report: 10n ** 18n,
		fee: 10n ** 15n,
		feePercentage: 1000000000000000n,
		initialReporter: zeroAddress,
		isDistributed: false,
		lastReportOppoTime: 0n,
		multiplier: 2n * 10n ** 18n,
		numReports: 0n,
		openOracleAddress: '0x1000000000000000000000000000000000000000',
		price: 0n,
		protocolFee: 0n,
		protocolFeeRecipient: zeroAddress,
		reportId: 7n,
		reportTimestamp: 0n,
		settlementTime: 86400n,
		settlementTimestamp: 0n,
		settlerReward: 10n ** 15n,
		stateHash: '0x1234000000000000000000000000000000000000000000000000000000000000',
		timeType: true,
		token1: '0x2000000000000000000000000000000000000000',
		token1Decimals: 18,
		token1Symbol: 'REPv2',
		token2: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
		token2Decimals: 18,
		token2Symbol: 'WETH',
		trackDisputes: false,
		...overrides,
	}
}

function createOpenOracleTokenAccessState(overrides: Partial<OpenOracleSectionProps['openOracleTokenAccessState']> = {}): OpenOracleSectionProps['openOracleTokenAccessState'] {
	return {
		token1Approval: {
			error: undefined,
			loading: false,
			value: 0n,
		},
		token1Balance: 100n * 10n ** 18n,
		token1BalanceError: undefined,
		token1Decimals: 18,
		token2Approval: {
			error: undefined,
			loading: false,
			value: 0n,
		},
		token2Balance: 100n * 10n ** 18n,
		token2BalanceError: undefined,
		token2Decimals: 18,
		tokenAccessLoadingInitial: false,
		tokenAccessRefreshing: false,
		...overrides,
	}
}

function createOpenOracleSectionProps(overrides: Partial<OpenOracleSectionProps> = {}): OpenOracleSectionProps {
	return {
		accountState: createAccountState(),
		activeView: 'browse',
		environmentReady: true,
		environmentRefreshKey: 0,
		loadingOpenOracleCreate: false,
		onActiveViewChange: () => undefined,
		onApproveToken1: () => undefined,
		onApproveToken2: () => undefined,
		onCancelOpenOracleWithdrawalBalanceCheck: () => undefined,
		onCreateOpenOracleGame: () => undefined,
		onDisputeReport: () => undefined,
		onLoadOracleReport: () => undefined,
		onOpenOracleCreateFormChange: () => undefined,
		onOpenOracleFormChange: () => undefined,
		onSettleReport: () => undefined,
		onWithdrawOpenOracleBalance: () => undefined,
		openOracleActiveAction: undefined,
		openOracleActiveWithdrawalBalance: undefined,
		openOracleCreateForm: getDefaultOpenOracleCreateFormState(),
		openOracleDisputeSubmission: undefined,
		openOracleError: undefined,
		openOracleForm: createOpenOracleForm(),
		openOracleReportLookupState: 'unknown',
		openOracleReportDetails: undefined,
		openOracleResult: undefined,
		openOracleTokenAccessState: createOpenOracleTokenAccessState(),
		openOracleWithdrawalBalanceChecking: false,
		openOracleWithdrawalReviewMessage: undefined,
		openOracleWithdrawableBalances: undefined,
		openOracleWithdrawableBalancesError: undefined,
		openOracleWithdrawableBalancesLoading: false,
		...overrides,
	}
}

function createDeferred<T>() {
	let resolvePromise: ((value: T) => void) | undefined
	const promise = new Promise<T>(resolve => {
		resolvePromise = resolve
	})
	return {
		promise,
		resolve(value: T) {
			if (resolvePromise === undefined) throw new Error('Deferred promise resolver is unavailable')
			resolvePromise(value)
		},
	}
}

function createEmptyBrowsePage(pageIndex = 0): OpenOracleReportSummaryPage {
	return {
		nextReportId: 1n,
		pageIndex,
		pageSize: 10,
		reportCount: 0n,
		reports: [],
	}
}

function createOpenOracleDisputeSubmission({
	openOracleForm = createOpenOracleForm(),
	openOracleTokenAccessState = createOpenOracleTokenAccessState(),
	openOracleReportDetails = createOpenOracleReportDetails({
		currentReporter: getAddress('0x3000000000000000000000000000000000000000'),
		currentTime: 200n,
		disputeDelay: 10n,
		reportTimestamp: 100n,
	}),
}: {
	openOracleForm?: OpenOracleFormState
	openOracleTokenAccessState?: OpenOracleSectionProps['openOracleTokenAccessState']
	openOracleReportDetails?: OpenOracleReportDetails
} = {}): OpenOracleDisputeSubmissionDetails {
	return deriveOpenOracleDisputeSubmissionDetails({
		approvedToken1Amount: openOracleTokenAccessState.token1Approval.value,
		approvedToken2Amount: openOracleTokenAccessState.token2Approval.value,
		disputeNewAmount1Input: openOracleForm.disputeNewAmount1,
		disputeNewAmount2Input: openOracleForm.disputeNewAmount2,
		disputeTokenToSwap: openOracleForm.disputeTokenToSwap,
		reportDetails: openOracleReportDetails,
		token1AllowanceError: openOracleTokenAccessState.token1Approval.error,
		token1Balance: openOracleTokenAccessState.token1Balance,
		token1BalanceError: openOracleTokenAccessState.token1BalanceError,
		token1Decimals: openOracleTokenAccessState.token1Decimals ?? openOracleReportDetails.token1Decimals,
		token2AllowanceError: openOracleTokenAccessState.token2Approval.error,
		token2Balance: openOracleTokenAccessState.token2Balance,
		token2BalanceError: openOracleTokenAccessState.token2BalanceError,
		token2Decimals: openOracleTokenAccessState.token2Decimals ?? openOracleReportDetails.token2Decimals,
	})
}

function renderDisputeActionSection({
	accountState = createAccountState(),
	isMainnet = true,
	openOracleForm = createOpenOracleForm(),
	openOracleTokenAccessState = createOpenOracleTokenAccessState(),
	openOracleReportDetails = createOpenOracleReportDetails({
		currentReporter: getAddress('0x3000000000000000000000000000000000000000'),
		reportTimestamp: 100n,
	}),
}: {
	accountState?: AccountState
	isMainnet?: boolean
	openOracleForm?: OpenOracleFormState
	openOracleTokenAccessState?: OpenOracleSectionProps['openOracleTokenAccessState']
	openOracleReportDetails?: OpenOracleReportDetails
} = {}) {
	const disputeSubmission = createOpenOracleDisputeSubmission({
		openOracleForm,
		openOracleTokenAccessState,
		openOracleReportDetails,
	})

	return renderSelectedReportActionSection({
		actionMode: 'dispute',
		disputeSubmission,
		isConnected: accountState.address !== undefined,
		isMainnet,
		onApproveToken1: () => undefined,
		onApproveToken2: () => undefined,
		onDisputeReport: () => undefined,
		onOpenOracleFormChange: () => undefined,
		onSettleReport: () => undefined,
		openOracleActiveAction: undefined,
		openOracleForm,
		openOracleTokenAccessState,
		openOracleReportDetails,
		token1Symbol: openOracleReportDetails.token1Symbol,
		token2Symbol: openOracleReportDetails.token2Symbol,
	})
}

function renderSettleActionSection({
	accountState = createAccountState(),
	isMainnet = true,
	openOracleForm = createOpenOracleForm(),
	openOracleReportDetails = createOpenOracleReportDetails({
		currentReporter: getAddress('0x3000000000000000000000000000000000000000'),
		currentTime: 161n,
		disputeDelay: 10n,
		reportTimestamp: 100n,
		settlementTime: 60n,
	}),
}: {
	accountState?: AccountState
	isMainnet?: boolean
	openOracleForm?: OpenOracleFormState
	openOracleReportDetails?: OpenOracleReportDetails
} = {}) {
	return renderSelectedReportActionSection({
		actionMode: 'settle',
		disputeSubmission: undefined,
		isConnected: accountState.address !== undefined,
		isMainnet,
		onApproveToken1: () => undefined,
		onApproveToken2: () => undefined,
		onDisputeReport: () => undefined,
		onOpenOracleFormChange: () => undefined,
		onSettleReport: () => undefined,
		openOracleActiveAction: undefined,
		openOracleForm,
		openOracleTokenAccessState: createOpenOracleTokenAccessState(),
		openOracleReportDetails,
		token1Symbol: openOracleReportDetails.token1Symbol,
		token2Symbol: openOracleReportDetails.token2Symbol,
	})
}

void describe('OpenOracleSection', () => {
	void test('waits for the active environment before loading browse reports', async () => {
		const domEnvironment = installDomEnvironment()
		let browseLoadAttempts = 0
		const restoreActiveEnvironment = installActiveEnvironmentForTesting({
			...createFakeBackend(),
			createReadClient: () => {
				browseLoadAttempts += 1
				throw new Error('Browse reports must not load before the environment is ready')
			},
		})
		const rendered = await renderIntoDocument(<OpenOracleSection {...createOpenOracleSectionProps()} environmentReady={false} />)

		try {
			await Promise.resolve()
			expect(browseLoadAttempts).toBe(0)
			expect(within(document.body).getByText('Preparing report summaries.')).not.toBeNull()
			expect(within(document.body).getByRole('status', { name: 'Preparing report summaries.' })).not.toBeNull()
			expect(within(document.body).queryByText('No Open Oracle reports found.')).toBeNull()
		} finally {
			await rendered.cleanup()
			restoreActiveEnvironment()
			domEnvironment.cleanup()
		}
	})

	void test('shows failed browse loads with retry instead of a confirmed empty state', async () => {
		const domEnvironment = installDomEnvironment()
		let browseLoadAttempts = 0
		const restoreActiveEnvironment = installActiveEnvironmentForTesting({
			...createFakeBackend(),
			createReadClient: () => {
				browseLoadAttempts += 1
				throw new Error('Report summary service unavailable')
			},
		})
		const rendered = await renderIntoDocument(<OpenOracleSection {...createOpenOracleSectionProps()} />)

		try {
			await Promise.resolve()
			await Promise.resolve()
			const documentQueries = within(document.body)
			expect(documentQueries.getByText('Report summary service unavailable')).not.toBeNull()
			expect(documentQueries.queryByText('No Open Oracle reports found.')).toBeNull()

			fireEvent.click(documentQueries.getByRole('button', { name: 'Retry' }))
			await Promise.resolve()
			await Promise.resolve()
			expect(browseLoadAttempts).toBe(2)
			expect(documentQueries.queryByText('No Open Oracle reports found.')).toBeNull()
		} finally {
			await rendered.cleanup()
			restoreActiveEnvironment()
			domEnvironment.cleanup()
		}
	})

	void test('invalidates ready browse state across environment changes and ignores late responses', async () => {
		const domEnvironment = installDomEnvironment()
		const secondEnvironmentLoad = createDeferred<OpenOracleReportSummaryPage>()
		const thirdEnvironmentLoad = createDeferred<OpenOracleReportSummaryPage>()
		let browseLoadAttempts = 0
		const loadBrowseReports = () => {
			browseLoadAttempts += 1
			if (browseLoadAttempts === 1) return Promise.resolve(createEmptyBrowsePage())
			if (browseLoadAttempts === 2) return secondEnvironmentLoad.promise
			return thirdEnvironmentLoad.promise
		}
		const rendered = await renderIntoDocument(<OpenOracleSection {...createOpenOracleSectionProps({ loadBrowseReports })} />)

		try {
			await act(async () => {
				await Promise.resolve()
				await Promise.resolve()
			})
			const documentQueries = within(document.body)
			expect(documentQueries.getByText('No Open Oracle reports found.')).not.toBeNull()

			await act(() => {
				render(<OpenOracleSection {...createOpenOracleSectionProps({ environmentRefreshKey: 1, loadBrowseReports })} />, rendered.container)
			})
			expect(documentQueries.getByRole('status', { name: 'Refreshing report summaries.' })).not.toBeNull()
			expect(documentQueries.queryByText('No Open Oracle reports found.')).toBeNull()

			await act(() => {
				render(<OpenOracleSection {...createOpenOracleSectionProps({ environmentRefreshKey: 2, loadBrowseReports })} />, rendered.container)
			})
			await act(async () => {
				secondEnvironmentLoad.resolve(createEmptyBrowsePage())
				await secondEnvironmentLoad.promise
			})
			expect(documentQueries.getByRole('status', { name: 'Refreshing report summaries.' })).not.toBeNull()
			expect(documentQueries.queryByText('No Open Oracle reports found.')).toBeNull()

			await act(async () => {
				thirdEnvironmentLoad.resolve(createEmptyBrowsePage())
				await thirdEnvironmentLoad.promise
			})
			expect(documentQueries.getByText('No Open Oracle reports found.')).not.toBeNull()
			expect(browseLoadAttempts).toBe(3)
		} finally {
			await rendered.cleanup()
			domEnvironment.cleanup()
		}
	})

	void test('renders settle-only controls after the dispute window closes', () => {
		const section = renderSettleActionSection({
			openOracleReportDetails: createOpenOracleReportDetails({
				currentReporter: getAddress('0x3000000000000000000000000000000000000000'),
				currentTime: 161n,
				disputeDelay: 10n,
				reportTimestamp: 100n,
				settlementTime: 60n,
			}),
		})

		const settleButton = findButton(section, 'Settle Report')
		if (settleButton === undefined) throw new Error('Expected settle action button to render')

		expect(getButtonDisabled(settleButton)).toBe(false)
		expect(findButton(section, 'Dispute & Swap')).toBeUndefined()
		expect(getSectionTitles(section)).toContain('Settlement Summary')
		expect(getSectionTitles(section)).not.toContain('Settle Report')
		expect(getSectionTitles(section)).not.toContain('Dispute Report')
		expect(getButtonDisabledReason(settleButton)).toBeUndefined()
	})

	void test('disables dispute before dispute delay and disables settle before settlement time', () => {
		const section = renderDisputeActionSection({
			openOracleReportDetails: createOpenOracleReportDetails({
				currentReporter: getAddress('0x3000000000000000000000000000000000000000'),
				currentTime: 109n,
				disputeDelay: 10n,
				reportTimestamp: 100n,
				settlementTime: 60n,
			}),
		})

		const disputeButton = findButton(section, 'Dispute & Swap')
		if (disputeButton === undefined) throw new Error('Expected dispute action button to render')

		expect(getButtonDisabled(disputeButton)).toBe(true)
		expect(findButton(section, 'Settle Report')).toBeUndefined()
		expect(getButtonDisabledReason(disputeButton)).toBe('This report is not ready to dispute.')
		expect(getTextContent(section).includes('Blocked:')).toBe(false)
		expect(getSectionTitles(section)).toContain('Current Report State')
		expect(getSectionTitles(section)).not.toContain('Dispute Report')
	})

	void test('renders dispute approval controls and blocks submit until required approvals are present', () => {
		const tokenUnits = 10n ** 18n
		const openOracleReportDetails = createOpenOracleReportDetails({
			currentAmount1: 10n * tokenUnits,
			currentAmount2: 5n * tokenUnits,
			currentReporter: getAddress('0x3000000000000000000000000000000000000000'),
			currentTime: 200n,
			disputeDelay: 10n,
			escalationHalt: 20n * tokenUnits,
			feePercentage: 0n,
			multiplier: 20_000n,
			protocolFee: 0n,
			reportTimestamp: 100n,
			settlementTime: 200n,
		})
		const openOracleForm = createOpenOracleForm({
			disputeNewAmount1: '20',
			disputeNewAmount2: '7',
		})
		const openOracleTokenAccessState = createOpenOracleTokenAccessState({
			token1Approval: {
				error: undefined,
				loading: false,
				value: 0n,
			},
			token2Approval: {
				error: undefined,
				loading: false,
				value: 0n,
			},
		})
		const section = renderDisputeActionSection({
			openOracleForm,
			openOracleTokenAccessState,
			openOracleReportDetails,
		})

		expect(getSectionTitles(section)).toContain('REPv2 Approval')
		expect(getSectionTitles(section)).toContain('WETH Approval')
		expect(getTextContent(section)).toContain('REPv2 approval required')
		const disputeButton = findButton(section, 'Dispute & Swap')
		if (disputeButton === undefined) throw new Error('Expected dispute action button to render')
		expect(getButtonDisabled(disputeButton)).toBe(true)
	})

	void test('accepts human-readable token decimals for dispute amounts', () => {
		const tokenUnits = 10n ** 18n
		const openOracleReportDetails = createOpenOracleReportDetails({
			currentAmount1: tokenUnits,
			currentAmount2: 5n * tokenUnits,
			currentReporter: getAddress('0x3000000000000000000000000000000000000000'),
			currentTime: 200n,
			disputeDelay: 10n,
			escalationHalt: 2n * tokenUnits,
			feePercentage: 0n,
			multiplier: 20_000n,
			protocolFee: 0n,
			reportTimestamp: 100n,
			settlementTime: 200n,
		})
		const openOracleForm = createOpenOracleForm({
			disputeNewAmount1: '2',
			disputeNewAmount2: '7.5',
		})
		const openOracleTokenAccessState = createOpenOracleTokenAccessState({
			token1Approval: {
				error: undefined,
				loading: false,
				value: 100n * tokenUnits,
			},
			token2Approval: {
				error: undefined,
				loading: false,
				value: 100n * tokenUnits,
			},
		})

		const disputeSubmission = createOpenOracleDisputeSubmission({
			openOracleForm,
			openOracleReportDetails,
			openOracleTokenAccessState,
		})

		expect(disputeSubmission.expectedNewAmount1).toBe(2n * tokenUnits)
		expect(disputeSubmission.canSubmit).toBe(true)
		expect(disputeSubmission.blockMessage).toBeUndefined()
	})

	void test('renders dispute balance blockers when the wallet lacks the required swap contribution', () => {
		const tokenUnits = 10n ** 18n
		const openOracleReportDetails = createOpenOracleReportDetails({
			currentAmount1: 10n * tokenUnits,
			currentAmount2: 5n * tokenUnits,
			currentReporter: getAddress('0x3000000000000000000000000000000000000000'),
			currentTime: 200n,
			disputeDelay: 10n,
			escalationHalt: 20n * tokenUnits,
			feePercentage: 0n,
			multiplier: 20_000n,
			protocolFee: 0n,
			reportTimestamp: 100n,
			settlementTime: 200n,
		})
		const openOracleForm = createOpenOracleForm({
			disputeNewAmount1: '20',
			disputeNewAmount2: '7',
		})
		const openOracleTokenAccessState = createOpenOracleTokenAccessState({
			token1Approval: {
				error: undefined,
				loading: false,
				value: 100n * tokenUnits,
			},
			token2Approval: {
				error: undefined,
				loading: false,
				value: 100n * tokenUnits,
			},
			token2Balance: 1n * tokenUnits,
		})
		const section = renderDisputeActionSection({
			openOracleForm,
			openOracleTokenAccessState,
			openOracleReportDetails,
		})

		expect(getTextContent(section)).toContain('Insufficient WETH balance for this dispute. Need 2, wallet has 1.')
		const disputeButton = findButton(section, 'Dispute & Swap')
		if (disputeButton === undefined) throw new Error('Expected dispute action button to render')
		expect(getButtonDisabledReason(disputeButton)).toBe('Insufficient WETH balance for this dispute. Need 2, wallet has 1.')
	})

	void test('keeps create and selected-report actions disabled off mainnet with recovery guidance', () => {
		const disputeSection = renderDisputeActionSection({ isMainnet: false })
		const disputeButton = findButton(disputeSection, 'Dispute & Swap')
		if (disputeButton === undefined) throw new Error('Expected dispute action button to render')
		expect(getButtonDisabled(disputeButton)).toBe(true)
		expect(getButtonDisabledReason(disputeButton)).toBe('Switch to Ethereum mainnet.')

		const settleSection = renderSettleActionSection({ isMainnet: false })
		const settleButton = findButton(settleSection, 'Settle Report')
		if (settleButton === undefined) throw new Error('Expected settle action button to render')
		expect(getButtonDisabled(settleButton)).toBe(true)
		expect(getButtonDisabledReason(settleButton)).toBe('Switch to Ethereum mainnet.')
	})

	void test('keeps downstream selected-report blocker copy hidden off mainnet', () => {
		const invalidDisputeSection = renderDisputeActionSection({
			isMainnet: false,
			openOracleForm: createOpenOracleForm({ reportId: '' }),
		})
		const disputeButton = findButton(invalidDisputeSection, 'Dispute & Swap')
		if (disputeButton === undefined) throw new Error('Expected dispute action button to render')
		expect(getButtonDisabled(disputeButton)).toBe(true)
		expect(getButtonDisabledReason(disputeButton)).toBe('Switch to Ethereum mainnet.')
		expect(getTextContent(invalidDisputeSection)).not.toContain('Load a report first.')

		const invalidSettleSection = renderSettleActionSection({
			isMainnet: false,
			openOracleForm: createOpenOracleForm({ reportId: '' }),
			openOracleReportDetails: createOpenOracleReportDetails({
				currentTime: 100n,
				reportTimestamp: 100n,
				settlementTime: 60n,
			}),
		})
		const settleButton = findButton(invalidSettleSection, 'Settle Report')
		if (settleButton === undefined) throw new Error('Expected settle action button to render')
		expect(getButtonDisabled(settleButton)).toBe(true)
		expect(getButtonDisabledReason(settleButton)).toBe('Switch to Ethereum mainnet.')
		expect(getTextContent(invalidSettleSection)).not.toContain('Load a report first.')
	})

	void test('keeps disconnected-wallet reasons for selected-report actions', () => {
		const disconnectedAccount = createAccountState({ address: undefined })

		const disputeSection = renderDisputeActionSection({ accountState: disconnectedAccount })
		const disputeButton = findButton(disputeSection, 'Dispute & Swap')
		if (disputeButton === undefined) throw new Error('Expected dispute action button to render')
		expect(getButtonDisabled(disputeButton)).toBe(true)
		expect(getButtonDisabledReason(disputeButton)).toBe('Connect a wallet before disputing the report.')

		const settleSection = renderSettleActionSection({ accountState: disconnectedAccount })
		const settleButton = findButton(settleSection, 'Settle Report')
		if (settleButton === undefined) throw new Error('Expected settle action button to render')
		expect(getButtonDisabled(settleButton)).toBe(true)
		expect(getButtonDisabledReason(settleButton)).toBe('Connect a wallet before settling the report.')
	})
})
