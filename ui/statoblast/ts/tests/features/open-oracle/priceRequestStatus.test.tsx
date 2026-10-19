import { ReportingOracleBlocker } from '@zoltar/ui-statoblast-shared/features/reporting/components/ReportingOracleBlocker.js'
import { createOracleManagerDetails } from '../security-pools/workflow/builders.js'
import { describe, expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import { TransactionActionButtonLockProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { PriceRequestStatusSection, type PriceRequestStatusProps } from '@zoltar/ui-statoblast-shared/features/open-oracle/components/PriceRequestStatusSection.js'
import { getDefaultOpenOracleFormState } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/formDefaults.js'
import type { OpenOracleReportDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'

const lifecycle = installDomTestLifecycle()

async function renderRequest(overrides: Partial<PriceRequestStatusProps> = {}) {
	return lifecycle.trackRendered(await renderIntoDocument(<PriceRequestStatusSection {...props(overrides)} />))
}

function createOpenOracleReportDetails(overrides: Partial<OpenOracleReportDetails> = {}): OpenOracleReportDetails {
	return {
		callbackContract: zeroAddress,
		callbackGasLimit: 0,
		currentBlockNumber: 0n,
		currentAmount1: 0n,
		currentAmount2: 0n,
		currentReporter: '0x3000000000000000000000000000000000000000',
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
		reportTimestamp: 100n,
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

function props(overrides: Partial<PriceRequestStatusProps> = {}): PriceRequestStatusProps {
	return {
		accountState: createAccountState({ address: zeroAddress, chainId: getActiveNetworkProfile().chainIdHex }),
		onLoadOracleReport: () => undefined,
		onOpenOracleFormChange: () => undefined,
		onSettleReport: () => undefined,
		openOracleForm: { ...getDefaultOpenOracleFormState(), reportId: '7' },
		openOracleReportDetails: createOpenOracleReportDetails({ reportTimestamp: 100n, currentTime: 200n, settlementTime: 60n, price: 3n * 10n ** 30n }),
		openOracleReportLookupState: 'ready',
		openOracleActiveAction: undefined,
		openOracleError: undefined,
		...overrides,
	}
}

describe('Statoblast price requests', () => {
	test('shows request status and finalization without standalone operations', async () => {
		const onSettleReport = mock(() => undefined)
		const rendered = await renderRequest({ onSettleReport })
		const query = within(rendered.container)
		expect(query.getByRole('heading', { name: 'Price reports' })).toBeTruthy()
		expect(query.getByRole('heading', { name: 'Report status' })).toBeTruthy()
		expect(query.getByText('Ready to settle')).toBeTruthy()
		expect(rendered.container.textContent).toContain('3.00')
		const settle = query.getByRole('button', { name: 'Settle report' })
		expectTransactionButtonEnabled(rendered.container, 'Settle report')
		fireEvent.click(settle)
		expect(onSettleReport).toHaveBeenCalledTimes(1)
		for (const label of ['Browse reports', 'Create report', 'Dispute report', 'Withdraw']) expect(rendered.container.textContent).not.toContain(label)
	})

	test('keeps finalization disabled before settlement and after distribution', async () => {
		for (const report of [createOpenOracleReportDetails({ reportTimestamp: 100n, currentTime: 110n, settlementTime: 60n }), createOpenOracleReportDetails({ isDistributed: true })]) {
			const rendered = await renderRequest({ openOracleReportDetails: report })
			expectTransactionButtonDisabled(rendered.container, 'Settle report')
			await rendered.cleanup()
		}
	})

	test('does not finalize a stale report while a replacement request loads', async () => {
		const rendered = await renderRequest({ openOracleForm: { ...getDefaultOpenOracleFormState(), reportId: '8' }, openOracleReportLookupState: 'loading' })
		expectTransactionButtonDisabled(rendered.container, 'Settle report')
	})

	test('exposes a retry through the request lookup after a failed read', async () => {
		const onLoadOracleReport = mock(() => undefined)
		const rendered = await renderRequest({ onLoadOracleReport, openOracleReportDetails: undefined, openOracleReportLookupState: 'load-failed', openOracleError: 'RPC unavailable' })
		expect(rendered.container.textContent).toContain('RPC unavailable')
		fireEvent.click(within(rendered.container).getByRole('button', { name: 'Open report' }))
		expect(onLoadOracleReport).toHaveBeenCalledWith('7')
	})

	test('keeps missing requests and invalid IDs from exposing a transaction', async () => {
		const onLoadOracleReport = mock(() => undefined)
		const rendered = await renderRequest({ onLoadOracleReport, openOracleReportDetails: undefined, openOracleReportLookupState: 'missing' })
		const query = within(rendered.container)
		expect(rendered.container.textContent).toContain('Price report not found')
		expect(query.queryByRole('button', { name: 'Settle report' })).toBeNull()
		for (const value of ['', '-1', 'abc', '1.5']) {
			await act(() => fireEvent.input(query.getByLabelText('Report ID'), { target: { value } }))
			expect(query.getByRole('button', { name: 'Open report' }).hasAttribute('disabled')).toBe(true)
		}
		expect(onLoadOracleReport).not.toHaveBeenCalled()
	})

	test('blocks finalization for a disconnected wallet and a wrong network', async () => {
		for (const accountState of [createAccountState({ address: undefined }), createAccountState({ address: zeroAddress, chainId: '0x1' })]) {
			const onSettleReport = mock(() => undefined)
			const rendered = await renderRequest({ accountState, onSettleReport })
			expectTransactionButtonDisabled(rendered.container, 'Settle report')
			expect(onSettleReport).not.toHaveBeenCalled()
			await rendered.cleanup()
		}
	})

	test('keeps the finalization control disabled while its transaction is pending', async () => {
		const rendered = await renderRequest({ openOracleActiveAction: 'settle' })
		expectTransactionButtonDisabled(rendered.container, 'Settling report…')
	})

	test.each([
		{ reportId: '7', locked: true },
		{ reportId: '8', locked: false },
	])('applies a restored pending settlement lock for report $reportId', async ({ reportId, locked }) => {
		const onSettleReport = mock(() => undefined)
		const rendered = lifecycle.trackRendered(
			await renderIntoDocument(
				<TransactionActionButtonLockProvider lock={{ lockedScopes: [[`open-oracle-report:${reportId}`]], promptOpen: false }}>
					<PriceRequestStatusSection {...props({ onSettleReport, openOracleActiveAction: undefined })} />
				</TransactionActionButtonLockProvider>,
			),
		)
		if (locked) {
			expectTransactionButtonDisabled(rendered.container, 'Settle report')
			expect(rendered.container.textContent).toContain('Waiting for a pending transaction on this item.')
		} else {
			expectTransactionButtonEnabled(rendered.container, 'Settle report')
		}
		fireEvent.click(within(rendered.container).getByRole('button', { name: 'Settle report' }))
		expect(onSettleReport).toHaveBeenCalledTimes(locked ? 0 : 1)
	})
})

test('prepares the pending reporting price report and settles with one click', async () => {
	const settle = mock(() => undefined)
	const load = mock(() => undefined)
	const oracle = props({
		onSettleReport: settle,
		onLoadOracleReport: load,
		openOracleForm: { ...getDefaultOpenOracleFormState(), reportId: '7' },
		openOracleReportDetails: createOpenOracleReportDetails({ currentReporter: '0x3000000000000000000000000000000000000000', currentTime: 200n, reportTimestamp: 100n, settlementTime: 2n, timeType: true }),
	})
	const rendered = lifecycle.trackRendered(
		await renderIntoDocument(<ReportingOracleBlocker blocked manager={createOracleManagerDetails({ pendingReportId: 7n, pendingReportReadyAtTimestamp: 102n })} now={200n} onRequest={() => undefined} requestReason={undefined} onRefresh={() => undefined} oracle={oracle} onViewReport={() => undefined} />),
	)
	expect(load).toHaveBeenCalledWith('7')
	expect(settle).toHaveBeenCalledTimes(0)
	fireEvent.click(within(rendered.container).getByRole('button', { name: 'Settle report #7' }))
	expect(settle).toHaveBeenCalledTimes(1)
	expect(within(rendered.container).queryByRole('dialog')).toBeNull()
})
