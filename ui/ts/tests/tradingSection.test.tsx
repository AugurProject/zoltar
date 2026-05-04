/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { EnumDropdown } from '../components/EnumDropdown.js'
import { MetricField } from '../components/MetricField.js'
import { TradingSection } from '../components/TradingSection.js'
import { MARKET_NOT_FINALIZED_MESSAGE, NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE, NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE, SHARE_MIGRATION_AFTER_FORK_MESSAGE } from '../lib/trading.js'
import type { AccountState, TradingFormState } from '../types/app.js'
import type { ListedSecurityPool, MarketDetails, TradingDetails, TradingShareBalances } from '../types/contracts.js'
import type { TradingSectionProps } from '../types/components.js'

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

function getDetailTexts(node: unknown) {
	const detailTexts: string[] = []
	visitTree(node, vnode => {
		if (vnode.type !== 'p' || vnode.props['className'] !== 'detail') return
		detailTexts.push(getTextContent(vnode.props['children']))
	})
	return detailTexts
}

function findButton(node: unknown, label: string) {
	let matchingButton: VNodeLike | undefined
	visitTree(node, vnode => {
		if (matchingButton !== undefined || vnode.type !== 'button') return
		if (getTextContent(vnode.props['children']).trim() === label) matchingButton = vnode
	})
	return matchingButton
}

function findFirstNodeByType(node: unknown, type: unknown) {
	let matchingNode: VNodeLike | undefined
	visitTree(node, vnode => {
		if (matchingNode !== undefined || vnode.type !== type) return
		matchingNode = vnode
	})
	return matchingNode
}

function createMarketDetails(): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Question description',
		displayValueMax: 100n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId: '0x01',
		startTime: 1n,
		title: 'Will this resolve?',
	}
}

function createSelectedPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	return {
		completeSetCollateralAmount: 0n,
		currentRetentionRate: 10n,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		lastOraclePrice: undefined,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedRep: 0n,
		parent: zeroAddress,
		questionOutcome: 'yes',
		questionId: '0x01',
		securityMultiplier: 2n,
		securityPoolAddress: zeroAddress,
		systemState: 'operational',
		totalRepDeposit: 0n,
		totalSecurityBondAllowance: 5n * 10n ** 18n,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 0n,
		universeHasForked: false,
		universeId: 1n,
		vaultCount: 0n,
		vaults: [],
		...overrides,
	}
}

function createShareBalances(overrides: Partial<TradingShareBalances> = {}): TradingShareBalances {
	return {
		invalid: 2n * 10n ** 18n,
		no: 4n * 10n ** 18n,
		yes: 3n * 10n ** 18n,
		...overrides,
	}
}

function createTradingDetails(overrides: Partial<TradingDetails> = {}): TradingDetails {
	const shareBalances = createShareBalances()
	return {
		maxRedeemableCompleteSets: 2n * 10n ** 18n,
		shareBalances,
		universeId: 1n,
		...overrides,
	}
}

function createTradingForm(overrides: Partial<TradingFormState> = {}): TradingFormState {
	return {
		completeSetAmount: '1',
		redeemAmount: '1',
		securityPoolAddress: zeroAddress,
		selectedShareOutcome: 'yes',
		targetOutcomeIndexes: '',
		...overrides,
	}
}

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		walletChainId: '0x1',
		ethBalance: 10n * 10n ** 18n,
		wethBalance: 0n,
		...overrides,
	}
}

function createTradingSectionProps(overrides: Partial<TradingSectionProps> = {}): TradingSectionProps {
	return {
		accountState: createAccountState(),
		embedInCard: true,
		loadingTradingForkUniverse: false,
		loadingTradingDetails: false,
		onCreateCompleteSet: () => undefined,
		onMigrateShares: () => undefined,
		onRedeemCompleteSet: () => undefined,
		onRedeemShares: () => undefined,
		onTradingFormChange: () => undefined,
		repEthPrice: undefined,
		repEthSource: undefined,
		repEthSourceUrl: undefined,
		selectedPool: createSelectedPool(),
		showHeader: false,
		showSecurityPoolAddressInput: false,
		tradingDetails: createTradingDetails(),
		tradingError: undefined,
		tradingForkUniverse: undefined,
		tradingForm: createTradingForm(),
		tradingResult: undefined,
		...overrides,
	}
}

function renderTradingSection(overrides: Partial<TradingSectionProps> = {}) {
	return TradingSection(createTradingSectionProps(overrides))
}

void describe('TradingSection', () => {
	void test('renames the max complete sets metric to total complete sets', () => {
		const section = renderTradingSection()
		const metricFieldLabels = getMetricFieldLabels(section)

		expect(metricFieldLabels).toContain('Total Complete Sets')
		expect(metricFieldLabels).not.toContain('Max Complete Sets')
	})

	void test('keeps minting disabled silently when the pool has no active allowance', () => {
		const section = renderTradingSection({
			selectedPool: createSelectedPool({
				completeSetCollateralAmount: 0n,
				totalRepDeposit: 20n * 10n ** 18n,
				totalSecurityBondAllowance: 0n,
				universeHasForked: false,
			}),
			tradingForm: createTradingForm({ completeSetAmount: '100' }),
		})
		const mintButton = findButton(section, 'Mint Complete Sets')
		const detailTexts = getDetailTexts(section)

		expect(mintButton).toBeDefined()
		expect(mintButton?.props['disabled']).toBe(true)
		expect(mintButton?.props['title']).toBeUndefined()
		expect(detailTexts).not.toContain(NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE)
	})

	void test('keeps complete-set redemption disabled silently when the wallet lacks matching shares', () => {
		const section = renderTradingSection({
			selectedPool: createSelectedPool({ universeHasForked: false }),
			tradingDetails: createTradingDetails({
				maxRedeemableCompleteSets: 0n,
				shareBalances: createShareBalances({
					invalid: 0n,
					no: 2n * 10n ** 18n,
					yes: 2n * 10n ** 18n,
				}),
			}),
			tradingForm: createTradingForm({ redeemAmount: '1' }),
		})
		const redeemButton = findButton(section, 'Redeem Complete Sets')
		const detailTexts = getDetailTexts(section)

		expect(redeemButton).toBeDefined()
		expect(redeemButton?.props['disabled']).toBe(true)
		expect(redeemButton?.props['title']).toBeUndefined()
		expect(detailTexts).not.toContain(NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE)
	})

	void test('keeps share migration disabled silently before the universe forks', () => {
		const section = renderTradingSection({
			selectedPool: createSelectedPool({ universeHasForked: false }),
		})
		const migrateButton = findButton(section, 'Migrate Shares')
		const detailTexts = getDetailTexts(section)

		expect(migrateButton).toBeDefined()
		expect(migrateButton?.props['disabled']).toBe(true)
		expect(migrateButton?.props['title']).toBeUndefined()
		expect(detailTexts).not.toContain(SHARE_MIGRATION_AFTER_FORK_MESSAGE)
	})

	void test('disables the share outcome dropdown before the selected pool universe forks', () => {
		const section = renderTradingSection({
			selectedPool: createSelectedPool({ universeHasForked: false }),
		})
		const shareOutcomeDropdown = findFirstNodeByType(section, EnumDropdown)

		expect(shareOutcomeDropdown).toBeDefined()
		expect(shareOutcomeDropdown?.props['disabled']).toBe(true)
	})

	void test('keeps share redemption disabled silently before finalization', () => {
		const section = renderTradingSection({
			selectedPool: createSelectedPool({ questionOutcome: 'none' }),
		})
		const redeemSharesButton = findButton(section, 'Redeem Shares')
		const detailTexts = getDetailTexts(section)

		expect(redeemSharesButton).toBeDefined()
		expect(redeemSharesButton?.props['disabled']).toBe(true)
		expect(redeemSharesButton?.props['title']).toBeUndefined()
		expect(detailTexts).not.toContain(MARKET_NOT_FINALIZED_MESSAGE)
	})

	void test('keeps non-suppressed trading guard messages visible', () => {
		const section = renderTradingSection({
			loadingTradingDetails: true,
			tradingDetails: undefined,
		})
		const redeemButton = findButton(section, 'Redeem Complete Sets')
		const detailTexts = getDetailTexts(section)

		expect(redeemButton).toBeDefined()
		expect(redeemButton?.props['disabled']).toBe(true)
		expect(redeemButton?.props['title']).toBe('Loading wallet share balances.')
		expect(detailTexts).toContain('Loading wallet share balances.')
	})
})
