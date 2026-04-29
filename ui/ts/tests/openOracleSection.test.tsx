/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { MetricField } from '../components/MetricField.js'
import { renderSelectedReportActionSection } from '../components/OpenOracleSection.js'
import { deriveOpenOracleInitialReportSubmissionDetails } from '../lib/openOracle.js'
import { getDefaultOpenOracleFormState } from '../lib/marketForm.js'
import type { AccountState, OpenOracleFormState } from '../types/app.js'
import type { OpenOracleSectionProps } from '../types/components.js'
import type { OpenOracleReportDetails } from '../types/contracts.js'

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

function findButton(node: unknown, label: string) {
	let matchingButton: VNodeLike | undefined
	visitTree(node, vnode => {
		if (matchingButton !== undefined || vnode.type !== 'button') return
		if (getTextContent(vnode.props['children']).trim() === label) matchingButton = vnode
	})
	return matchingButton
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
		callbackSelector: '0x00000000',
		currentAmount1: 0n,
		currentAmount2: 0n,
		currentReporter: zeroAddress,
		disputeDelay: 3600n,
		disputeOccurred: false,
		escalationHalt: 5n * 10n ** 17n,
		exactToken1Report: 10n ** 18n,
		fee: 10n ** 15n,
		feePercentage: 1000000000000000n,
		feeToken: false,
		initialReporter: zeroAddress,
		isDistributed: false,
		keepFee: false,
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

function renderInitialReportActionSection({
	accountState = createAccountState(),
	openOracleForm = createOpenOracleForm(),
	openOracleInitialReportState = createOpenOracleInitialReportState(),
	openOracleReportDetails = createOpenOracleReportDetails(),
}: {
	accountState?: AccountState
	openOracleForm?: OpenOracleFormState
	openOracleInitialReportState?: OpenOracleSectionProps['openOracleInitialReportState']
	openOracleReportDetails?: OpenOracleReportDetails
} = {}) {
	const initialReportSubmission = deriveOpenOracleInitialReportSubmissionDetails({
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

	return renderSelectedReportActionSection(
		'initial-report',
		accountState.address !== undefined,
		undefined,
		openOracleForm,
		initialReportSubmission,
		openOracleInitialReportState,
		openOracleReportDetails.token1Symbol,
		openOracleReportDetails.token2Symbol,
		() => undefined,
		() => undefined,
		() => undefined,
		() => undefined,
		() => undefined,
		() => undefined,
		() => undefined,
		() => undefined,
	)
}

void describe('OpenOracleSection', () => {
	void test('removes the redundant wallet metric row from the selected initial report action', () => {
		const section = renderInitialReportActionSection()
		const metricFieldLabels = getMetricFieldLabels(section)
		const textContent = getTextContent(section)
		const submitButton = findButton(section, 'Submit Initial Report')

		expect(metricFieldLabels).not.toContain('Wallet REPv2')
		expect(metricFieldLabels).not.toContain('Wallet WETH')
		expect(textContent).toContain('Initial Report')
		expect(textContent).toContain('REPv2 Approval')
		expect(textContent).toContain('WETH Approval')
		expect(submitButton).toBeDefined()
	})
})
