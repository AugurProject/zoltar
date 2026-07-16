/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { MetricField } from '../../../components/MetricField.js'
import { renderSelectedReportActionSection } from '../../../features/open-oracle/components/OpenOracleSection.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { deriveOpenOracleDisputeSubmissionDetails, deriveOpenOracleInitialReportSubmissionDetails, getOpenOracleSelectedReportActionMode, type OpenOracleDisputeSubmissionDetails, type OpenOracleInitialReportSubmissionDetails } from '../../../features/open-oracle/lib/openOracle.js'
import { getDefaultOpenOracleFormState } from '../../../features/markets/lib/marketForm.js'
import type { AccountState, OpenOracleFormState } from '../../../types/app.js'
import type { OpenOracleSectionProps } from '../../../features/types.js'
import type { OpenOracleReportDetails } from '../../../types/contracts.js'

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

function getMetricFieldLabels(node: unknown) {
	const labels: string[] = []
	visitTree(node, vnode => {
		if (vnode.type !== MetricField) return
		const label = vnode.props['label']
		if (typeof label === 'string') labels.push(label)
	})
	return labels
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

function getButtonLabels(node: unknown) {
	const labels: string[] = []
	visitTree(node, vnode => {
		const label = getButtonLikeLabel(vnode)
		if (label !== undefined) labels.push(label)
	})
	return labels
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

function hasVNodeType(node: unknown, type: unknown) {
	let found = false
	visitTree(node, vnode => {
		if (found || vnode.type !== type) return
		found = true
	})
	return found
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

function createOpenOracleInitialReportState(overrides: Partial<OpenOracleSectionProps['openOracleInitialReportState']> = {}): OpenOracleSectionProps['openOracleInitialReportState'] {
	return {
		defaultPrice: '2',
		defaultPriceError: undefined,
		defaultPriceSource: 'Uniswap V3',
		defaultPriceSourceUrl: 'https://app.uniswap.org/explore/pools/ethereum/0x1',
		ethBalance: 2n * 10n ** 18n,
		ethBalanceError: undefined,
		quoteAttemptedSources: undefined,
		quoteFailureKind: undefined,
		quoteFailureReason: undefined,
		quoteLoading: false,
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

function createOpenOracleDisputeSubmission({
	openOracleForm = createOpenOracleForm(),
	openOracleInitialReportState = createOpenOracleInitialReportState(),
	openOracleReportDetails = createOpenOracleReportDetails({
		currentReporter: getAddress('0x3000000000000000000000000000000000000000'),
		currentTime: 200n,
		disputeDelay: 10n,
		reportTimestamp: 100n,
	}),
}: {
	openOracleForm?: OpenOracleFormState
	openOracleInitialReportState?: OpenOracleSectionProps['openOracleInitialReportState']
	openOracleReportDetails?: OpenOracleReportDetails
} = {}): OpenOracleDisputeSubmissionDetails {
	return deriveOpenOracleDisputeSubmissionDetails({
		approvedToken1Amount: openOracleInitialReportState.token1Approval.value,
		approvedToken2Amount: openOracleInitialReportState.token2Approval.value,
		disputeNewAmount1Input: openOracleForm.disputeNewAmount1,
		disputeNewAmount2Input: openOracleForm.disputeNewAmount2,
		disputeTokenToSwap: openOracleForm.disputeTokenToSwap,
		reportDetails: openOracleReportDetails,
		token1AllowanceError: openOracleInitialReportState.token1Approval.error,
		token1Balance: openOracleInitialReportState.token1Balance,
		token1BalanceError: openOracleInitialReportState.token1BalanceError,
		token1Decimals: openOracleInitialReportState.token1Decimals ?? openOracleReportDetails.token1Decimals,
		token2AllowanceError: openOracleInitialReportState.token2Approval.error,
		token2Balance: openOracleInitialReportState.token2Balance,
		token2BalanceError: openOracleInitialReportState.token2BalanceError,
		token2Decimals: openOracleInitialReportState.token2Decimals ?? openOracleReportDetails.token2Decimals,
	})
}

function renderInitialReportActionSection({
	accountState = createAccountState(),
	isMainnet = true,
	openOracleForm = createOpenOracleForm(),
	openOracleInitialReportState = createOpenOracleInitialReportState(),
	openOracleReportDetails = createOpenOracleReportDetails(),
}: {
	accountState?: AccountState
	isMainnet?: boolean
	openOracleForm?: OpenOracleFormState
	openOracleInitialReportState?: OpenOracleSectionProps['openOracleInitialReportState']
	openOracleReportDetails?: OpenOracleReportDetails
} = {}) {
	const initialReportSubmission: OpenOracleInitialReportSubmissionDetails = deriveOpenOracleInitialReportSubmissionDetails({
		approvedToken1Amount: openOracleInitialReportState.token1Approval.value,
		approvedToken2Amount: openOracleInitialReportState.token2Approval.value,
		defaultPrice: openOracleInitialReportState.defaultPrice,
		defaultPriceError: openOracleInitialReportState.defaultPriceError,
		defaultPriceSource: openOracleInitialReportState.defaultPriceSource,
		defaultPriceSourceUrl: openOracleInitialReportState.defaultPriceSourceUrl,
		priceInput: openOracleForm.price,
		quoteAttemptedSources: openOracleInitialReportState.quoteAttemptedSources,
		quoteFailureReason: openOracleInitialReportState.quoteFailureReason,
		reportDetails: openOracleReportDetails,
		token1AllowanceError: openOracleInitialReportState.token1Approval.error,
		token1Balance: openOracleInitialReportState.token1Balance,
		token1BalanceError: openOracleInitialReportState.token1BalanceError,
		token1Decimals: openOracleInitialReportState.token1Decimals ?? openOracleReportDetails.token1Decimals,
		token2AllowanceError: openOracleInitialReportState.token2Approval.error,
		token2Balance: openOracleInitialReportState.token2Balance,
		token2BalanceError: openOracleInitialReportState.token2BalanceError,
		token2Decimals: openOracleInitialReportState.token2Decimals ?? openOracleReportDetails.token2Decimals,
		walletEthBalance: openOracleInitialReportState.ethBalance,
	})

	return renderSelectedReportActionSection({
		actionMode: 'initial-report',
		disputeSubmission: undefined,
		initialReportSubmission,
		isConnected: accountState.address !== undefined,
		isMainnet,
		onApproveToken1: () => undefined,
		onApproveToken2: () => undefined,
		onDisputeReport: () => undefined,
		onOpenOracleFormChange: () => undefined,
		onRefreshPrice: () => undefined,
		onSettleReport: () => undefined,
		onSubmitInitialReport: () => undefined,
		onWrapWethForInitialReport: () => undefined,
		openOracleActiveAction: undefined,
		openOracleForm,
		openOracleInitialReportState,
		openOracleReportDetails,
		token1Symbol: openOracleReportDetails.token1Symbol,
		token2Symbol: openOracleReportDetails.token2Symbol,
	})
}

function renderDisputeActionSection({
	accountState = createAccountState(),
	isMainnet = true,
	openOracleForm = createOpenOracleForm(),
	openOracleInitialReportState = createOpenOracleInitialReportState(),
	openOracleReportDetails = createOpenOracleReportDetails({
		currentReporter: getAddress('0x3000000000000000000000000000000000000000'),
		reportTimestamp: 100n,
	}),
}: {
	accountState?: AccountState
	isMainnet?: boolean
	openOracleForm?: OpenOracleFormState
	openOracleInitialReportState?: OpenOracleSectionProps['openOracleInitialReportState']
	openOracleReportDetails?: OpenOracleReportDetails
} = {}) {
	const disputeSubmission = createOpenOracleDisputeSubmission({
		openOracleForm,
		openOracleInitialReportState,
		openOracleReportDetails,
	})

	return renderSelectedReportActionSection({
		actionMode: getOpenOracleSelectedReportActionMode(openOracleReportDetails),
		disputeSubmission,
		initialReportSubmission: deriveOpenOracleInitialReportSubmissionDetails({
			approvedToken1Amount: 0n,
			approvedToken2Amount: 0n,
			defaultPrice: undefined,
			defaultPriceError: undefined,
			defaultPriceSource: undefined,
			defaultPriceSourceUrl: undefined,
			priceInput: '',
			quoteAttemptedSources: undefined,
			quoteFailureReason: undefined,
			reportDetails: undefined,
			token1AllowanceError: undefined,
			token1Balance: undefined,
			token1BalanceError: undefined,
			token1Decimals: openOracleReportDetails.token1Decimals,
			token2AllowanceError: undefined,
			token2Balance: undefined,
			token2BalanceError: undefined,
			token2Decimals: openOracleReportDetails.token2Decimals,
			walletEthBalance: undefined,
		}),
		isConnected: accountState.address !== undefined,
		isMainnet,
		onApproveToken1: () => undefined,
		onApproveToken2: () => undefined,
		onDisputeReport: () => undefined,
		onOpenOracleFormChange: () => undefined,
		onRefreshPrice: () => undefined,
		onSettleReport: () => undefined,
		onSubmitInitialReport: () => undefined,
		onWrapWethForInitialReport: () => undefined,
		openOracleActiveAction: undefined,
		openOracleForm,
		openOracleInitialReportState,
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
		initialReportSubmission: deriveOpenOracleInitialReportSubmissionDetails({
			approvedToken1Amount: 0n,
			approvedToken2Amount: 0n,
			defaultPrice: undefined,
			defaultPriceError: undefined,
			defaultPriceSource: undefined,
			defaultPriceSourceUrl: undefined,
			priceInput: '',
			quoteAttemptedSources: undefined,
			quoteFailureReason: undefined,
			reportDetails: undefined,
			token1AllowanceError: undefined,
			token1Balance: undefined,
			token1BalanceError: undefined,
			token1Decimals: openOracleReportDetails.token1Decimals,
			token2AllowanceError: undefined,
			token2Balance: undefined,
			token2BalanceError: undefined,
			token2Decimals: openOracleReportDetails.token2Decimals,
			walletEthBalance: undefined,
		}),
		isConnected: accountState.address !== undefined,
		isMainnet,
		onApproveToken1: () => undefined,
		onApproveToken2: () => undefined,
		onDisputeReport: () => undefined,
		onOpenOracleFormChange: () => undefined,
		onRefreshPrice: () => undefined,
		onSettleReport: () => undefined,
		onSubmitInitialReport: () => undefined,
		onWrapWethForInitialReport: () => undefined,
		openOracleActiveAction: undefined,
		openOracleForm,
		openOracleInitialReportState: createOpenOracleInitialReportState(),
		openOracleReportDetails,
		token1Symbol: openOracleReportDetails.token1Symbol,
		token2Symbol: openOracleReportDetails.token2Symbol,
	})
}

void describe('OpenOracleSection', () => {
	void test('removes the redundant wallet metric row from the selected initial report action', () => {
		const section = renderInitialReportActionSection()
		const metricFieldLabels = getMetricFieldLabels(section)
		const textContent = getTextContent(section)
		const sectionTitles = getSectionTitles(section)
		const buttonLabels = getButtonLabels(section)
		const wrapButton = findButton(section, 'Wrap needed ETH to WETH')
		const submitButton = findButton(section, 'Submit Initial Report')

		expect(metricFieldLabels).not.toContain('Wallet REPv2')
		expect(metricFieldLabels).not.toContain('Wallet WETH')
		expect(sectionTitles).toContain('Initial Report')
		expect(sectionTitles).toContain('REPv2 Approval')
		expect(sectionTitles).toContain('WETH Approval')
		expect(textContent).not.toContain('determine whether this report needs more WETH')
		expect(buttonLabels.indexOf('Wrap needed ETH to WETH')).toBeGreaterThan(-1)
		expect(buttonLabels.indexOf('Wrap needed ETH to WETH')).toBeLessThan(buttonLabels.indexOf('Submit Initial Report'))
		expect(wrapButton).toBeDefined()
		expect(submitButton).toBeDefined()
	})

	void test('renders approval-required submission messages as normal detail text instead of an error notice', () => {
		const section = renderInitialReportActionSection({
			openOracleInitialReportState: createOpenOracleInitialReportState({
				token1Approval: {
					error: undefined,
					loading: false,
					value: 10n ** 18n,
				},
				token2Approval: {
					error: undefined,
					loading: false,
					value: 0n,
				},
			}),
		})

		expect(getTextContent(section)).toContain('WETH approval required')
		expect(hasVNodeType(section, ErrorNotice)).toBe(false)
	})

	void test('renders initial-report quote freshness metadata', () => {
		const section = renderInitialReportActionSection({
			openOracleInitialReportState: createOpenOracleInitialReportState({
				quoteBlockNumber: 123n,
				quoteLoadedAtMs: Date.now() - 70_000,
				quoteStale: true,
			}),
		})
		const textContent = getTextContent(section)

		expect(textContent).toContain('Quote loaded at block 123')
		expect(textContent).toContain('This quote is stale and will be refreshed before submission.')
	})

	void test('uses the shared form input for initial-report and dispute amount fields', () => {
		const initialReportSection = renderInitialReportActionSection()
		const disputeSection = renderDisputeActionSection()

		expect(hasVNodeType(initialReportSection, FormInput)).toBe(true)
		expect(hasVNodeType(disputeSection, FormInput)).toBe(true)
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
		const openOracleInitialReportState = createOpenOracleInitialReportState({
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
			openOracleInitialReportState,
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
		const openOracleInitialReportState = createOpenOracleInitialReportState({
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
			openOracleInitialReportState,
			openOracleReportDetails,
		})

		expect(getTextContent(section)).toContain('Insufficient WETH balance for this dispute. Need 2, wallet has 1.')
		const disputeButton = findButton(section, 'Dispute & Swap')
		if (disputeButton === undefined) throw new Error('Expected dispute action button to render')
		expect(getButtonDisabledReason(disputeButton)).toBe('Insufficient WETH balance for this dispute. Need 2, wallet has 1.')
	})

	void test('keeps create and selected-report actions disabled off mainnet with recovery guidance', () => {
		const initialReportSection = renderInitialReportActionSection({ isMainnet: false })
		const submitButton = findButton(initialReportSection, 'Submit Initial Report')
		if (submitButton === undefined) throw new Error('Expected initial report controls to render')
		expect(getButtonDisabled(submitButton)).toBe(true)
		expect(getButtonDisabledReason(submitButton)).toBe('Switch to Ethereum mainnet.')

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
		const invalidInitialReportSection = renderInitialReportActionSection({
			isMainnet: false,
			openOracleForm: createOpenOracleForm({ price: '' }),
		})
		const invalidSubmitButton = findButton(invalidInitialReportSection, 'Submit Initial Report')
		if (invalidSubmitButton === undefined) throw new Error('Expected initial report controls to render')
		expect(getButtonDisabled(invalidSubmitButton)).toBe(true)
		expect(getButtonDisabledReason(invalidSubmitButton)).toBe('Switch to Ethereum mainnet.')
		expect(getTextContent(invalidInitialReportSection)).not.toContain('Enter a valid')

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

		const initialReportSection = renderInitialReportActionSection({ accountState: disconnectedAccount })
		const submitButton = findButton(initialReportSection, 'Submit Initial Report')
		if (submitButton === undefined) throw new Error('Expected initial report controls to render')
		expect(getButtonDisabled(submitButton)).toBe(true)
		expect(getButtonDisabledReason(submitButton)).toBe('Connect a wallet before submitting the initial report.')

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
