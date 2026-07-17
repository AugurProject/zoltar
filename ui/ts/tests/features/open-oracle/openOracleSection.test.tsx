/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import { renderSelectedReportActionSection } from '../../../features/open-oracle/components/OpenOracleSection.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { deriveOpenOracleDisputeSubmissionDetails, getOpenOracleSelectedReportActionMode, type OpenOracleDisputeSubmissionDetails } from '../../../features/open-oracle/lib/openOracle.js'
import { getDefaultOpenOracleFormState } from '../../../features/markets/lib/marketForm.js'
import type { AccountState, OpenOracleFormState } from '../../../types/app.js'
import type { OpenOracleSectionProps } from '../../../features/types.js'
import type { OpenOracleReportDetails } from '../../../types/contracts.js'
import { OpenOracleSection } from '../../../features/open-oracle/components/OpenOracleSection.js'
import { getDefaultOpenOracleCreateFormState } from '../../../features/markets/lib/marketForm.js'
import { createFakeBackend } from '../../testUtils/fakeBackend.js'
import { installActiveEnvironmentForTesting } from '../../../lib/activeEnvironment.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
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

function createOpenOracleSectionProps(): OpenOracleSectionProps {
	return {
		accountState: createAccountState(),
		activeView: 'browse',
		environmentReady: true,
		loadingOpenOracleCreate: false,
		loadingOracleReport: false,
		onActiveViewChange: () => undefined,
		onApproveToken1: () => undefined,
		onApproveToken2: () => undefined,
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
		openOracleReportDetails: undefined,
		openOracleResult: undefined,
		openOracleTokenAccessState: createOpenOracleTokenAccessState(),
		openOracleWithdrawableBalances: undefined,
		openOracleWithdrawableBalancesError: undefined,
		openOracleWithdrawableBalancesLoading: false,
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
		actionMode: getOpenOracleSelectedReportActionMode(openOracleReportDetails),
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
		} finally {
			await rendered.cleanup()
			restoreActiveEnvironment()
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
		expect(getSectionTitles(section)).toContain('Settle Report')
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
		expect(getSectionTitles(section)).toContain('Dispute Report')
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
			disputeNewAmount1: (20n * tokenUnits).toString(),
			disputeNewAmount2: (7n * tokenUnits).toString(),
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
			disputeNewAmount1: (20n * tokenUnits).toString(),
			disputeNewAmount2: (7n * tokenUnits).toString(),
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
