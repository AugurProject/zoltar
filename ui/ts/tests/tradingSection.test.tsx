/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { zeroAddress } from 'viem'
import { EntityCard } from '../components/EntityCard.js'
import { EnumDropdown } from '../components/EnumDropdown.js'
import { MetricField } from '../components/MetricField.js'
import { SectionBlock } from '../components/SectionBlock.js'
import { TransactionActionButton } from '../components/TransactionActionButton.js'
import { TradingSection } from '../components/TradingSection.js'
import { MARKET_NOT_FINALIZED_MESSAGE, NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE, NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE, SHARE_MIGRATION_AFTER_FORK_MESSAGE } from '../lib/trading.js'
import type { AccountState, TradingFormState } from '../types/app.js'
import type { ListedSecurityPool, MarketDetails, TradingDetails, TradingShareBalances, ZoltarUniverseSummary } from '../types/contracts.js'
import type { TradingSectionProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

type VNodeLike = {
	props: Record<string, unknown>
	type: unknown
}

type ButtonState = {
	disabled: boolean
	label: string
	title: string | undefined
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

function getSectionBlockTitles(node: unknown) {
	const titles: string[] = []
	visitTree(node, vnode => {
		if (vnode.type !== SectionBlock) return
		const title = vnode.props['title']
		if (typeof title === 'string') titles.push(title)
	})
	return titles
}

function getEntityCardTitles(node: unknown) {
	const titles: string[] = []
	visitTree(node, vnode => {
		if (vnode.type !== EntityCard) return
		const title = vnode.props['title']
		if (typeof title === 'string') titles.push(title)
	})
	return titles
}

function getDetailTexts(node: unknown) {
	const detailTexts: string[] = []
	visitTree(node, vnode => {
		if (vnode.type !== 'p' || vnode.props['className'] !== 'detail') return
		detailTexts.push(getTextContent(vnode.props['children']))
	})
	visitTree(node, vnode => {
		const buttonState = getButtonState(vnode)
		if (buttonState?.disabled !== true || buttonState.title === undefined) return
		detailTexts.push(buttonState.title)
	})
	return detailTexts
}

function getButtonState(vnode: VNodeLike): ButtonState | undefined {
	if (vnode.type === 'button') {
		const title = vnode.props['title']
		return {
			disabled: vnode.props['disabled'] === true,
			label: getTextContent(vnode.props['children']).trim(),
			title: typeof title === 'string' ? title : undefined,
		}
	}

	if (vnode.type !== TransactionActionButton) return undefined

	const idleLabel = vnode.props['idleLabel']
	if (typeof idleLabel !== 'string') return undefined

	const availability = vnode.props['availability']
	const disabled = vnode.props['disabled'] === true
	const pending = vnode.props['pending'] === true
	let disabledByAvailability = false
	let title: string | undefined

	if (isObjectRecord(availability)) {
		disabledByAvailability = availability['disabled'] === true
		const availabilityReason = availability['reason']
		if (typeof availabilityReason === 'string') title = availabilityReason
	}

	return {
		disabled: disabled || pending || disabledByAvailability,
		label: idleLabel,
		title,
	}
}

function findButton(node: unknown, label: string) {
	let matchingButton: ButtonState | undefined
	visitTree(node, vnode => {
		if (matchingButton !== undefined) return
		const buttonState = getButtonState(vnode)
		if (buttonState?.label === label) matchingButton = buttonState
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
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		selectedPool: createSelectedPool(),
		showHeader: false,
		showSecurityPoolAddressInput: false,
		tradingActiveAction: undefined,
		tradingDetails: createTradingDetails(),
		tradingError: undefined,
		tradingForkUniverse: undefined,
		tradingForm: createTradingForm(),
		tradingResult: undefined,
		...overrides,
	}
}

function createScalarForkUniverse(): ZoltarUniverseSummary {
	return {
		childUniverses: [
			{
				exists: true,
				forkTime: 1n,
				outcomeIndex: 2n,
				outcomeLabel: '20 USD',
				parentUniverseId: 1n,
				reputationToken: zeroAddress,
				universeId: 2n,
			},
		],
		forkThreshold: 0n,
		forkQuestionDetails: {
			...createMarketDetails(),
			answerUnit: 'USD',
			displayValueMax: 100n,
			displayValueMin: 0n,
			marketType: 'scalar',
			numTicks: 10n,
			outcomeLabels: [],
		},
		forkTime: 1n,
		forkingOutcomeIndex: 0n,
		hasForked: true,
		parentUniverseId: 1n,
		reputationToken: zeroAddress,
		totalTheoreticalSupply: 0n,
		universeId: 10n,
	}
}

function TradingSectionHarness({ tradingForkUniverse }: { tradingForkUniverse: ZoltarUniverseSummary }) {
	const [tradingForm, setTradingForm] = useState<TradingFormState>(createTradingForm())

	return (
		<TradingSection
			{...createTradingSectionProps({
				selectedPool: createSelectedPool({ universeHasForked: true }),
				tradingForkUniverse,
				tradingForm,
			})}
			onTradingFormChange={update => setTradingForm(current => ({ ...current, ...update }))}
		/>
	)
}

function renderTradingSection(overrides: Partial<TradingSectionProps> = {}) {
	return TradingSection(createTradingSectionProps(overrides))
}

void describe('TradingSection', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	void test('renames the max complete sets metric to total complete sets', () => {
		const section = renderTradingSection()
		const metricFieldLabels = getMetricFieldLabels(section)

		expect(metricFieldLabels).toContain('Total Complete Sets')
		expect(metricFieldLabels).not.toContain('Max Complete Sets')
	})

	void test('renders workflow content as section blocks instead of a generic trading actions card', () => {
		const section = renderTradingSection({ embedInCard: false, showHeader: false })
		const sectionTitles = getSectionBlockTitles(section)
		const entityCardTitles = getEntityCardTitles(section)

		expect(sectionTitles).not.toContain('Pool Context')
		expect(sectionTitles).toContain('Your Shares')
		expect(sectionTitles).toContain('Mint Complete Sets')
		expect(sectionTitles).toContain('Redeem Complete Sets')
		expect(sectionTitles).toContain('Migrate Forked Shares')
		expect(sectionTitles).toContain('Redeem Resolved Shares')
		expect(entityCardTitles).not.toContain('Trading Actions')
	})

	void test('shows the minting disabled reason when the pool has no active allowance', () => {
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
		expect(mintButton?.disabled).toBe(true)
		expect(mintButton?.title).toBe(NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE)
		expect(detailTexts).toContain(NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE)
	})

	void test('shows the complete-set redemption disabled reason when the wallet lacks matching shares', () => {
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
		expect(redeemButton?.disabled).toBe(true)
		expect(redeemButton?.title).toBe(NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE)
		expect(detailTexts).toContain(NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE)
	})

	void test('shows the share migration disabled reason before the universe forks', () => {
		const section = renderTradingSection({
			selectedPool: createSelectedPool({ universeHasForked: false }),
		})
		const migrateButton = findButton(section, 'Migrate Shares')
		const detailTexts = getDetailTexts(section)

		expect(migrateButton).toBeDefined()
		expect(migrateButton?.disabled).toBe(true)
		expect(migrateButton?.title).toBe(SHARE_MIGRATION_AFTER_FORK_MESSAGE)
		expect(detailTexts).toContain(SHARE_MIGRATION_AFTER_FORK_MESSAGE)
	})

	void test('disables the share outcome dropdown before the selected pool universe forks', () => {
		const section = renderTradingSection({
			selectedPool: createSelectedPool({ universeHasForked: false }),
		})
		const shareOutcomeDropdown = findFirstNodeByType(section, EnumDropdown)

		expect(shareOutcomeDropdown).toBeDefined()
		expect(shareOutcomeDropdown?.props['disabled']).toBe(true)
	})

	void test('shows the share redemption disabled reason before finalization', () => {
		const section = renderTradingSection({
			selectedPool: createSelectedPool({ questionOutcome: 'none' }),
		})
		const redeemSharesButton = findButton(section, 'Redeem Shares')
		const detailTexts = getDetailTexts(section)

		expect(redeemSharesButton).toBeDefined()
		expect(redeemSharesButton?.disabled).toBe(true)
		expect(redeemSharesButton?.title).toBe(MARKET_NOT_FINALIZED_MESSAGE)
		expect(detailTexts).toContain(MARKET_NOT_FINALIZED_MESSAGE)
	})

	void test('keeps non-suppressed trading guard messages visible', () => {
		const section = renderTradingSection({
			loadingTradingDetails: true,
			tradingDetails: undefined,
		})
		const redeemButton = findButton(section, 'Redeem Complete Sets')
		const detailTexts = getDetailTexts(section)

		expect(redeemButton).toBeDefined()
		expect(redeemButton?.disabled).toBe(true)
		expect(redeemButton?.title).toBe('Loading wallet share balances.')
		expect(detailTexts).toContain('Loading wallet share balances.')
	})

	void test('keeps scalar share migration interactive through the shared target list and picker', async () => {
		const renderedComponent = await renderIntoDocument(<TradingSectionHarness tradingForkUniverse={createScalarForkUniverse()} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const slider = documentQueries.getByRole('slider') as HTMLInputElement

		expect(documentQueries.getByText('Select Scalar Target')).not.toBeNull()
		expect(documentQueries.getByText('Select at least one scalar target universe.')).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Add Target' })).not.toBeNull()

		await act(() => {
			fireEvent.input(slider, {
				target: { value: '7' },
			})
		})

		expect(documentQueries.getByText('7 / 10')).not.toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Add Target' }))
		})

		expect(documentQueries.queryByText('Select at least one scalar target universe.')).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Remove Target' })).not.toBeNull()
	})
})
