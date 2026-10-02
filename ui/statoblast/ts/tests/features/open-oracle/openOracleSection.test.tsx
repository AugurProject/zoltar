/// <reference types="bun-types" />

import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { getLocalEntityScope } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { readFavoriteEntries, resetLocalEntityStoreForTesting, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { OpenOracleReportDetails, OpenOracleReportSummary, OpenOracleReportSummaryPage } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { renderSelectedReportActionSection } from '@zoltar/ui-statoblast-shared/features/open-oracle/components/OpenOracleReportContent.js'
import { OpenOracleSection } from '@zoltar/ui-statoblast-shared/features/open-oracle/components/OpenOracleSection.js'
import { getDefaultOpenOracleCreateFormState, getDefaultOpenOracleFormState } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/formDefaults.js'
import type { OpenOracleDisputeSubmissionDetails } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/openOracle.js'
import { deriveOpenOracleDisputeSubmissionDetails } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/openOracleDispute.js'
import { openOracleReportDownloadStore } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/reportBrowse.js'
import type { OpenOracleSectionProps } from '@zoltar/ui-statoblast-shared/features/oracleTypes.js'
import type { AccountState } from '@zoltar/ui-zoltar-shared/types/app.js'
import type { OpenOracleFormState } from '@zoltar/ui-statoblast-shared/types/app.js'
import { getWethAddress } from '@zoltar/ui-zoltar-shared/protocol/uniswapQuoter.js'
import { describe, expect, mock, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { createAccountState as createEmptyAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'

type VNodeLike = {
	props: Record<string, unknown>
	type: unknown
}

const REPORTER = getAddress('0x3000000000000000000000000000000000000000')
const TOKEN_UNITS = 10n ** 18n

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
	if (node.type === UserMessage) return getTextContent(node.props['detail'])
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

function requireButton(node: unknown, label: string) {
	const button = findButton(node, label)
	if (button === undefined) throw new Error(`Expected the ${label} button to render`)
	return button
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
	return createEmptyAccountState({ ethBalanceAttoEth: 10n * 10n ** 18n, wethBalanceAttoEth: 5n * 10n ** 18n, ...overrides })
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
		settlerRewardAttoEth: 10n ** 15n,
		stateHash: '0x1234000000000000000000000000000000000000000000000000000000000000',
		timeType: true,
		token1: '0x2000000000000000000000000000000000000000',
		token1Decimals: 18,
		token1Symbol: 'REPv2',
		token2: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
		token2Decimals: 18,
		token2Symbol: 'WETH',
		trackDisputes: false,
		feesOnlyAtHalt: false,
		flexibleEscalation: false,
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

async function flushAsyncWork() {
	await act(async () => {
		await new Promise(resolve => setTimeout(resolve, 0))
	})
}

function createReportSummary(reportId: bigint, overrides: Partial<OpenOracleReportSummary> = {}): OpenOracleReportSummary {
	return {
		currentAmount1: 10n ** 18n,
		currentAmount2: 2n * 10n ** 18n,
		currentReporter: REPORTER,
		disputeOccurred: false,
		exactToken1Report: 10n ** 18n,
		isDistributed: false,
		price: 2n * 10n ** 30n,
		reportId,
		reportTimestamp: 123n,
		settlementTimestamp: 0n,
		timeType: true,
		token1: getAddress('0x2000000000000000000000000000000000000000'),
		token1Decimals: 18,
		token1Symbol: 'REPv2',
		token2: getAddress('0x4000000000000000000000000000000000000000'),
		token2Decimals: 18,
		token2Symbol: 'WETH',
		...overrides,
	}
}

function createReportPage(pageIndex: number, reportCount: bigint, reports: OpenOracleReportSummary[]): OpenOracleReportSummaryPage {
	return { nextReportId: reportCount + 1n, pageIndex, pageSize: 10, reportCount, reports }
}

function seedFavoriteReports(reports: readonly OpenOracleReportSummary[]) {
	const scope = getLocalEntityScope('statoblast', 'oracleReport')
	openOracleReportDownloadStore.record(
		scope,
		reports.map(report => ({ data: report, id: report.reportId.toString() })),
	)
	for (const report of reports) setEntityFavorite(scope, report.reportId.toString(), true)
}

/** Each browse test starts with an empty browser store; `seed` runs against the fresh document before rendering. */
async function renderBrowseSection(overrides: Partial<OpenOracleSectionProps> = {}, seed?: () => void) {
	const domEnvironment = installDomEnvironment()
	resetLocalEntityStoreForTesting()
	seed?.()
	const rendered = await renderIntoDocument(<OpenOracleSection {...createOpenOracleSectionProps(overrides)} />)
	return {
		cleanup: async () => {
			await rendered.cleanup()
			resetLocalEntityStoreForTesting()
			domEnvironment.cleanup()
		},
		container: rendered.container,
	}
}

function getRenderedReportTitles() {
	return [...document.querySelectorAll('.comparison-record h3')].map(heading => heading.textContent)
}

async function clickButton(name: string) {
	await act(() => {
		fireEvent.click(within(document.body).getByRole('button', { name }))
	})
	await flushAsyncWork()
}

async function typeSearch(value: string) {
	const input = within(document.body).getByLabelText('Search reports')
	if (!(input instanceof window.HTMLInputElement)) throw new Error('Expected report search input')
	input.value = value
	await act(() => {
		input.dispatchEvent(new window.Event('input', { bubbles: true }))
	})
}

async function selectStatus(value: string) {
	const select = within(document.body).getByLabelText('Status')
	if (!(select instanceof window.HTMLSelectElement)) throw new Error('Expected status select')
	select.value = value
	await act(() => {
		select.dispatchEvent(new window.Event('change', { bubbles: true }))
	})
}

function createOpenOracleDisputeSubmission({
	openOracleForm = createOpenOracleForm(),
	openOracleTokenAccessState = createOpenOracleTokenAccessState(),
	openOracleReportDetails = createOpenOracleReportDetails({
		currentReporter: REPORTER,
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

type ReportActionSectionOptions = {
	accountState?: AccountState
	isOnActiveAppChain?: boolean
	openOracleForm?: OpenOracleFormState
	openOracleReportDetails?: OpenOracleReportDetails
}

function renderReportActionSection(
	actionMode: 'dispute' | 'settle',
	{ accountState = createAccountState(), isOnActiveAppChain = true, openOracleForm = createOpenOracleForm(), openOracleReportDetails }: Required<Pick<ReportActionSectionOptions, 'openOracleReportDetails'>> & ReportActionSectionOptions,
	openOracleTokenAccessState: OpenOracleSectionProps['openOracleTokenAccessState'],
	disputeSubmission: OpenOracleDisputeSubmissionDetails | undefined,
) {
	return renderSelectedReportActionSection({
		actionMode,
		disputeSubmission,
		isConnected: accountState.address !== undefined,
		isOnActiveAppChain,
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

function renderDisputeActionSection({
	openOracleForm = createOpenOracleForm(),
	openOracleTokenAccessState = createOpenOracleTokenAccessState(),
	openOracleReportDetails = createOpenOracleReportDetails({
		currentReporter: REPORTER,
		reportTimestamp: 100n,
	}),
	...options
}: ReportActionSectionOptions & { openOracleTokenAccessState?: OpenOracleSectionProps['openOracleTokenAccessState'] } = {}) {
	const disputeSubmission = createOpenOracleDisputeSubmission({ openOracleForm, openOracleTokenAccessState, openOracleReportDetails })
	return renderReportActionSection('dispute', { ...options, openOracleForm, openOracleReportDetails }, openOracleTokenAccessState, disputeSubmission)
}

function renderSettleActionSection({
	openOracleReportDetails = createOpenOracleReportDetails({
		currentReporter: REPORTER,
		currentTime: 161n,
		disputeDelay: 10n,
		reportTimestamp: 100n,
		settlementTime: 60n,
	}),
	...options
}: ReportActionSectionOptions = {}) {
	return renderReportActionSection('settle', { ...options, openOracleReportDetails }, createOpenOracleTokenAccessState(), undefined)
}

/** A report in its dispute window with 10 REPv2 / 5 WETH reported and no fees. */
function createDisputableReportDetails(overrides: Partial<OpenOracleReportDetails> = {}) {
	return createOpenOracleReportDetails({
		currentAmount1: 10n * TOKEN_UNITS,
		currentAmount2: 5n * TOKEN_UNITS,
		currentReporter: REPORTER,
		currentTime: 200n,
		disputeDelay: 10n,
		escalationHalt: 20n * TOKEN_UNITS,
		feePercentage: 0n,
		multiplier: 20_000n,
		protocolFee: 0n,
		reportTimestamp: 100n,
		settlementTime: 200n,
		...overrides,
	})
}

function createApprovedTokenAccessState(approvedAmount: bigint, overrides: Partial<OpenOracleSectionProps['openOracleTokenAccessState']> = {}) {
	const approval = { error: undefined, loading: false, value: approvedAmount }
	return createOpenOracleTokenAccessState({ token1Approval: approval, token2Approval: approval, ...overrides })
}

void describe('OpenOracleSection', () => {
	test('announces a create failure exactly once', async () => {
		const rendered = await renderBrowseSection({ activeView: 'create', openOracleError: 'Create request failed' })
		try {
			expect([...rendered.container.querySelectorAll('[role="alert"]')].filter(node => node.textContent?.includes('Create request failed'))).toHaveLength(1)
		} finally {
			await rendered.cleanup()
		}
	})

	void test('renders block-based report clocks as blocks instead of timestamps', async () => {
		const domEnvironment = installDomEnvironment()
		const rendered = await renderIntoDocument(
			<OpenOracleSection
				{...createOpenOracleSectionProps({
					activeView: 'selected-report',
					openOracleReportDetails: createOpenOracleReportDetails({
						currentBlockNumber: 300n,
						currentReporter: REPORTER,
						reportTimestamp: 123n,
						settlementTimestamp: 234n,
						timeType: false,
					}),
					openOracleReportLookupState: 'ready',
				})}
			/>,
		)

		try {
			const documentQueries = within(document.body)
			expect(documentQueries.getByText('Report block')).not.toBeNull()
			expect(documentQueries.getByText('Settlement block')).not.toBeNull()
			expect(documentQueries.getByText('123 blocks')).not.toBeNull()
			expect(documentQueries.getByText('234 blocks')).not.toBeNull()
		} finally {
			await rendered.cleanup()
			domEnvironment.cleanup()
		}
	})

	void test('names the canonical WETH as ETH in report price directions but keeps the token symbol for token actions', async () => {
		const domEnvironment = installDomEnvironment()
		const rendered = await renderIntoDocument(
			<OpenOracleSection
				{...createOpenOracleSectionProps({
					activeView: 'selected-report',
					openOracleReportDetails: createOpenOracleReportDetails({
						currentReporter: REPORTER,
						price: 3n * 10n ** 30n,
						reportTimestamp: 100n,
						token1: getWethAddress(),
						token1Symbol: 'WETH',
						token2: getAddress('0x2000000000000000000000000000000000000000'),
						token2Symbol: 'REP',
					}),
					openOracleReportLookupState: 'ready',
				})}
			/>,
		)

		try {
			const text = document.body.textContent ?? ''
			expect(text).toContain('REP per ETH')
			expect(text).not.toContain('per WETH')
			expect(text).toContain('WETH / REP')
		} finally {
			await rendered.cleanup()
			domEnvironment.cleanup()
		}
	})

	void test('keeps the symbol of a non-canonical token named WETH in report price directions', async () => {
		const browse = await renderBrowseSection({}, () => seedFavoriteReports([createReportSummary(1n, { token1: getAddress('0x5000000000000000000000000000000000000000'), token1Symbol: 'WETH', token2Symbol: 'REP' })]))
		try {
			expect(document.body.textContent).toContain('REP per WETH')
		} finally {
			await browse.cleanup()
		}
	})

	void test('renders block-based favorite summary clocks as blocks', async () => {
		const browse = await renderBrowseSection({}, () => seedFavoriteReports([createReportSummary(1n, { settlementTimestamp: 234n, timeType: false })]))
		try {
			const documentQueries = within(document.body)
			const searchInput = documentQueries.getByLabelText('Search reports')
			if (!(searchInput instanceof window.HTMLInputElement)) throw new Error('Expected report search input')
			expect(searchInput.placeholder).toBe('Report ID, token symbol, or token address')
			expect(documentQueries.getByText('Report block')).not.toBeNull()
			expect(documentQueries.getByText('Settlement block')).not.toBeNull()
			expect(documentQueries.getByText('123 blocks')).not.toBeNull()
			expect(documentQueries.getByText('234 blocks')).not.toBeNull()
		} finally {
			await browse.cleanup()
		}
	})

	void test('opens on favorite reports from the browser cache without reading OpenOracle', async () => {
		let browseLoadAttempts = 0
		const browse = await renderBrowseSection(
			{
				loadBrowseReports: async pageIndex => {
					browseLoadAttempts += 1
					return createReportPage(pageIndex, 0n, [])
				},
			},
			() => {
				const scope = getLocalEntityScope('statoblast', 'oracleReport')
				openOracleReportDownloadStore.record(
					scope,
					[createReportSummary(4n), createReportSummary(3n)].map(report => ({ data: report, id: report.reportId.toString() })),
				)
				setEntityFavorite(scope, '3', true)
			},
		)
		try {
			expect(browseLoadAttempts).toBe(0)
			expect(getRenderedReportTitles()).toEqual(['REPv2 / WETH · report #3'])
			expect(within(document.body).getByRole('button', { name: 'Favorite: REPv2 / WETH · report #3' }).getAttribute('aria-pressed')).toBe('true')
			expect(within(document.body).getByText('Favorites (1)')).not.toBeNull()
			expect(document.body.textContent).not.toMatch(/Downloaded|Discover/)
			expect(within(document.body).queryByRole('button', { name: 'Show downloaded reports' })).toBeNull()
			expect(browseLoadAttempts).toBe(0)
		} finally {
			await browse.cleanup()
		}
	})

	void test('searches and filters every favorite report without scanning', async () => {
		const reports = Array.from({ length: 12 }, (_, index) => {
			const reportId = BigInt(12 - index)
			if (reportId === 5n) return createReportSummary(reportId, { token1Symbol: 'DAI' })
			if (reportId === 2n) return createReportSummary(reportId, { isDistributed: true })
			return createReportSummary(reportId)
		})
		const browse = await renderBrowseSection({}, () => seedFavoriteReports(reports))
		try {
			const documentQueries = within(document.body)
			expect(getRenderedReportTitles()).toHaveLength(12)
			await typeSearch('dai')
			expect(getRenderedReportTitles()).toEqual(['DAI / WETH · report #5'])
			expect(documentQueries.getByText('1 of 12 reports shown.')).not.toBeNull()
			await typeSearch('no such token')
			expect(documentQueries.queryByText(/reports shown/)).toBeNull()
			expect(documentQueries.getByText('No favorite reports match the current search and status filters.')).not.toBeNull()
			await typeSearch('')
			await selectStatus('settled')
			expect(getRenderedReportTitles()).toEqual(['REPv2 / WETH · report #2'])
			expect(readFavoriteEntries(getLocalEntityScope('statoblast', 'oracleReport'))).toHaveLength(12)
		} finally {
			await browse.cleanup()
		}
	})

	void test('opens a cached report ID from empty favorites without a downloaded shortcut', async () => {
		const onLoadOracleReport = mock(async (_reportId: string) => undefined)
		const browse = await renderBrowseSection({ onLoadOracleReport }, () => {
			openOracleReportDownloadStore.record(getLocalEntityScope('statoblast', 'oracleReport'), [{ data: createReportSummary(4n), id: '4' }])
		})
		try {
			expect(within(document.body).getByText('No favorite reports yet')).not.toBeNull()
			expect(document.body.textContent).not.toMatch(/Downloaded|Discover/)
			await typeSearch('#4')
			await clickButton('Open report #4')
			expect(onLoadOracleReport).toHaveBeenCalledWith('4')
		} finally {
			await browse.cleanup()
		}
	})

	void test('removes an unstarred report from favorites while keeping its cached summary', async () => {
		const browse = await renderBrowseSection({}, () => seedFavoriteReports([createReportSummary(3n)]))
		try {
			await clickButton('Favorite: REPv2 / WETH · report #3')
			expect(getRenderedReportTitles()).toEqual([])
			expect(within(document.body).getByText('Favorites (0)')).not.toBeNull()
			const scope = getLocalEntityScope('statoblast', 'oracleReport')
			expect(readFavoriteEntries(scope)).toEqual([])
			expect(openOracleReportDownloadStore.read(scope).map(entry => entry.id)).toEqual(['3'])
		} finally {
			await browse.cleanup()
		}
	})

	void test('offers to open a report ID that is not downloaded', async () => {
		const onOpenOracleFormChange = mock((_update: Partial<OpenOracleFormState>) => undefined)
		const onActiveViewChange = mock((_view: string) => undefined)
		const browse = await renderBrowseSection({ onActiveViewChange, onOpenOracleFormChange })
		try {
			await typeSearch('#42')
			await clickButton('Open report #42')
			expect(onOpenOracleFormChange).toHaveBeenCalledWith({ reportId: '42' })
			expect(onActiveViewChange).toHaveBeenCalledWith('selected-report')
		} finally {
			await browse.cleanup()
		}
	})

	void test('keeps favorites available before the environment is ready without scanning', async () => {
		const loadBrowseReports = mock(async () => createReportPage(0, 0n, []))
		const browse = await renderBrowseSection({ environmentReady: false, loadBrowseReports }, () => seedFavoriteReports([createReportSummary(3n)]))
		try {
			expect(getRenderedReportTitles()).toEqual(['REPv2 / WETH · report #3'])
			expect(document.body.textContent).not.toMatch(/Downloaded|Discover/)
			expect(loadBrowseReports).not.toHaveBeenCalled()
		} finally {
			await browse.cleanup()
		}
	})

	void test('adds a newly created report to the downloaded reports without favoriting it', async () => {
		const browse = await renderBrowseSection({
			activeView: 'create',
			loadBrowseReports: async pageIndex => createReportPage(pageIndex, 9n, [createReportSummary(9n)]),
			openOracleResult: { action: 'createReportInstance', hash: '0x1234000000000000000000000000000000000000000000000000000000000000' },
		})
		try {
			await flushAsyncWork()
			const scope = getLocalEntityScope('statoblast', 'oracleReport')
			expect(openOracleReportDownloadStore.read(scope).map(entry => entry.id)).toEqual(['9'])
			expect(readFavoriteEntries(scope)).toEqual([])
		} finally {
			await browse.cleanup()
		}
	})

	void test('favorites an opened report once and keeps an un-star after the report refreshes', async () => {
		const openedReport = createOpenOracleReportDetails({ currentReporter: REPORTER, reportTimestamp: 100n })
		const selectedProps = { activeView: 'selected-report' as const, openOracleReportDetails: openedReport, openOracleReportLookupState: 'ready' as const }
		const browse = await renderBrowseSection(selectedProps)
		try {
			const scope = getLocalEntityScope('statoblast', 'oracleReport')
			const star = within(document.body).getByRole('button', { name: 'Favorite: Report #7' })
			expect(star.getAttribute('aria-pressed')).toBe('true')
			expect(readFavoriteEntries(scope).map(entry => entry.id)).toEqual(['7'])
			await act(() => {
				fireEvent.click(star)
			})
			expect(readFavoriteEntries(scope)).toEqual([])
			// A refresh keeps the loaded details while the lookup is loading, then replaces them.
			await act(() => {
				render(<OpenOracleSection {...createOpenOracleSectionProps({ ...selectedProps, openOracleReportLookupState: 'loading' })} />, browse.container)
			})
			await act(() => {
				render(<OpenOracleSection {...createOpenOracleSectionProps({ ...selectedProps, openOracleReportDetails: { ...openedReport, currentAmount1: 5n } })} />, browse.container)
			})
			expect(readFavoriteEntries(scope)).toEqual([])
			expect(openOracleReportDownloadStore.read(scope).map(entry => entry.data.currentAmount1)).toEqual([5n])
			await act(() => {
				render(<OpenOracleSection {...createOpenOracleSectionProps()} />, browse.container)
			})
			expect(within(document.body).getByText('No favorite reports yet')).not.toBeNull()
			expect(within(document.body).queryByRole('button', { name: 'Show downloaded reports' })).toBeNull()
			expect(getRenderedReportTitles()).toEqual([])
		} finally {
			await browse.cleanup()
		}
	})

	void test('renders settle-only controls after the dispute window closes', () => {
		const section = renderSettleActionSection({
			openOracleReportDetails: createOpenOracleReportDetails({
				currentReporter: REPORTER,
				currentTime: 161n,
				disputeDelay: 10n,
				reportTimestamp: 100n,
				settlementTime: 60n,
			}),
		})

		const settleButton = requireButton(section, 'Settle report #7')

		expect(getButtonDisabled(settleButton)).toBe(false)
		expect(findButton(section, 'Dispute & swap')).toBeUndefined()
		expect(getSectionTitles(section)).toContain('Settlement summary')
		expect(getSectionTitles(section)).not.toContain('Settle report')
		expect(getSectionTitles(section)).not.toContain('Dispute Report')
		expect(getButtonDisabledReason(settleButton)).toBeUndefined()
	})

	void test('disables dispute before dispute delay and disables settle before settlement time', () => {
		const section = renderDisputeActionSection({
			openOracleReportDetails: createOpenOracleReportDetails({
				currentReporter: REPORTER,
				currentTime: 109n,
				disputeDelay: 10n,
				reportTimestamp: 100n,
				settlementTime: 60n,
			}),
		})

		const disputeButton = requireButton(section, 'Dispute & swap')

		expect(getButtonDisabled(disputeButton)).toBe(true)
		expect(findButton(section, 'Settle report #7')).toBeUndefined()
		expect(getButtonDisabledReason(disputeButton)).toBe('This report is not ready to dispute.')
		expect(getTextContent(section).includes('Blocked:')).toBe(false)
		expect(getSectionTitles(section)).toContain('Current report state')
		expect(getSectionTitles(section)).not.toContain('Dispute Report')
	})

	void test('keeps the dispute action disabled within the reserve before settlement opens', () => {
		const section = renderDisputeActionSection({
			openOracleReportDetails: createDisputableReportDetails({ currentTime: 299n }),
		})
		const disputeButton = requireButton(section, 'Dispute & swap')
		expect(getButtonDisabled(disputeButton)).toBe(true)
		expect(getButtonDisabledReason(disputeButton)).toMatch(/ends too soon/)
		expect(findButton(section, 'Settle report #7')).toBeUndefined()
	})

	void test('renders dispute approval controls and blocks submit until required approvals are present', () => {
		const section = renderDisputeActionSection({
			openOracleForm: createOpenOracleForm({ disputeNewAmount1: '20', disputeNewAmount2: '7' }),
			openOracleTokenAccessState: createApprovedTokenAccessState(0n),
			openOracleReportDetails: createDisputableReportDetails(),
		})

		expect(getSectionTitles(section)).toContain('REPv2 approval')
		expect(getSectionTitles(section)).toContain('WETH approval')
		expect(getTextContent(section)).toContain('REPv2 approval required')
		expect(getButtonDisabled(requireButton(section, 'Dispute & swap'))).toBe(true)
	})

	void test('derives the swapped token from the proposed price instead of asking for it', () => {
		const disputeSubmission = createOpenOracleDisputeSubmission({
			openOracleForm: createOpenOracleForm({ disputeNewAmount2: '3' }),
			openOracleReportDetails: createDisputableReportDetails(),
			openOracleTokenAccessState: createApprovedTokenAccessState(100n * TOKEN_UNITS),
		})
		// A lower price swaps out the base token: the disputer posts 20 REPv2 plus the 10 REPv2 it buys out and gets 2 WETH back.
		expect(disputeSubmission.swapTokenKey).toBe('token1')
		expect(disputeSubmission.newAmount1).toBe(20n * TOKEN_UNITS)
		expect(disputeSubmission.token1ContributionAmount).toBe(30n * TOKEN_UNITS)
		expect(disputeSubmission.token2ContributionAmount).toBe(0n)
		expect(disputeSubmission.token2CreditAmount).toBe(2n * TOKEN_UNITS)
		expect(disputeSubmission.proposedPrice).toBe(15n * 10n ** 28n)
		expect(disputeSubmission.canSubmit).toBe(true)

		const higherPrice = createOpenOracleDisputeSubmission({
			openOracleForm: createOpenOracleForm({ disputeNewAmount2: '30' }),
			openOracleReportDetails: createDisputableReportDetails(),
			openOracleTokenAccessState: createApprovedTokenAccessState(100n * TOKEN_UNITS),
		})
		expect(higherPrice.swapTokenKey).toBe('token2')
		expect(higherPrice.token1ContributionAmount).toBe(10n * TOKEN_UNITS)
		expect(higherPrice.token2ContributionAmount).toBe(35n * TOKEN_UNITS)
	})

	void test('keeps dispute approval steps in place while the amounts are invalid', () => {
		const section = renderDisputeActionSection({
			openOracleForm: createOpenOracleForm({ disputeNewAmount2: '' }),
			openOracleReportDetails: createDisputableReportDetails(),
		})

		expect(getSectionTitles(section)).toContain('Dispute summary')
		expect(getSectionTitles(section)).toContain('REPv2 approval')
		expect(getSectionTitles(section)).toContain('WETH approval')
		expect(getTextContent(section)).toContain('Enter the new amounts to preview what you pay and receive.')
		expect(getButtonDisabled(requireButton(section, 'Dispute & swap'))).toBe(true)
	})

	void test('accepts human-readable token decimals for dispute amounts', () => {
		const disputeSubmission = createOpenOracleDisputeSubmission({
			openOracleForm: createOpenOracleForm({ disputeNewAmount1: '2', disputeNewAmount2: '7.5' }),
			openOracleReportDetails: createDisputableReportDetails({ currentAmount1: TOKEN_UNITS, escalationHalt: 2n * TOKEN_UNITS }),
			openOracleTokenAccessState: createApprovedTokenAccessState(100n * TOKEN_UNITS),
		})

		expect(disputeSubmission.expectedNewAmount1).toBe(2n * TOKEN_UNITS)
		expect(disputeSubmission.canSubmit).toBe(true)
		expect(disputeSubmission.blockMessage).toBeUndefined()
	})

	void test('renders dispute balance blockers when the wallet lacks the required swap contribution', () => {
		const section = renderDisputeActionSection({
			openOracleForm: createOpenOracleForm({ disputeNewAmount1: '20', disputeNewAmount2: '7' }),
			openOracleTokenAccessState: createApprovedTokenAccessState(100n * TOKEN_UNITS, { token2Balance: TOKEN_UNITS }),
			openOracleReportDetails: createDisputableReportDetails(),
		})

		expect(getTextContent(section)).toContain('Insufficient WETH balance for this dispute. Need 2, wallet has 1.')
		expect(getButtonDisabledReason(requireButton(section, 'Dispute & swap'))).toBe('Insufficient WETH balance for this dispute. Need 2, wallet has 1.')
	})

	void test('keeps create and selected-report actions disabled off Sepolia with recovery guidance', () => {
		const disputeSection = renderDisputeActionSection({ isOnActiveAppChain: false })
		const disputeButton = requireButton(disputeSection, 'Dispute & swap')
		expect(getButtonDisabled(disputeButton)).toBe(true)
		expect(getButtonDisabledReason(disputeButton)).toBe('Switch to Sepolia.')
		expect(disputeButton.props.showDisabledReason).toBe(false)
		expect(disputeButton.props.disabledReasonElementId).toContain('open-oracle-dispute-approval-guard-')

		const settleSection = renderSettleActionSection({ isOnActiveAppChain: false })
		const settleButton = requireButton(settleSection, 'Settle report #7')
		expect(getButtonDisabled(settleButton)).toBe(true)
		expect(getButtonDisabledReason(settleButton)).toBe('Switch to Sepolia.')
	})

	void test('keeps downstream selected-report blocker copy hidden off Sepolia', () => {
		const invalidDisputeSection = renderDisputeActionSection({
			isOnActiveAppChain: false,
			openOracleForm: createOpenOracleForm({ reportId: '' }),
		})
		const disputeButton = requireButton(invalidDisputeSection, 'Dispute & swap')
		expect(getButtonDisabled(disputeButton)).toBe(true)
		expect(getButtonDisabledReason(disputeButton)).toBe('Switch to Sepolia.')
		expect(getTextContent(invalidDisputeSection)).not.toContain('Load a report first.')

		const invalidSettleSection = renderSettleActionSection({
			isOnActiveAppChain: false,
			openOracleForm: createOpenOracleForm({ reportId: '' }),
			openOracleReportDetails: createOpenOracleReportDetails({
				currentTime: 100n,
				reportTimestamp: 100n,
				settlementTime: 60n,
			}),
		})
		const settleButton = requireButton(invalidSettleSection, 'Settle report #7')
		expect(getButtonDisabled(settleButton)).toBe(true)
		expect(getButtonDisabledReason(settleButton)).toBe('Switch to Sepolia.')
		expect(getTextContent(invalidSettleSection)).not.toContain('Load a report first.')
	})

	void test('keeps disconnected-wallet reasons for selected-report actions', () => {
		const disconnectedAccount = createAccountState({ address: undefined })

		const disputeSection = renderDisputeActionSection({ accountState: disconnectedAccount })
		const disputeButton = requireButton(disputeSection, 'Dispute & swap')
		expect(getButtonDisabled(disputeButton)).toBe(true)
		expect(getButtonDisabledReason(disputeButton)).toBe('Connect a wallet before disputing the report.')

		const settleSection = renderSettleActionSection({ accountState: disconnectedAccount })
		const settleButton = requireButton(settleSection, 'Settle report #7')
		expect(getButtonDisabled(settleButton)).toBe(true)
		expect(getButtonDisabledReason(settleButton)).toBe('Connect a wallet before settling the report.')
	})
})
