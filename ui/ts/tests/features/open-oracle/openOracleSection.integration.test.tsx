/// <reference types="bun-types" />

import { afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { fireEvent, waitFor, within } from '../../testUtils/queries'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import type { Address, Hash } from '@zoltar/shared/ethereum'
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import { OpenOracleSection } from '../../../features/open-oracle/components/OpenOracleSection.js'
import { ViewTabs } from '../../../components/ViewTabs.js'
import { approveErc20, createOpenOracleReportInstance, getOpenOracleAddress, loadErc20Allowance, loadErc20Balance, loadOpenOracleReportDetails, submitInitialOracleReport, wrapWeth } from '../../../protocol/index.js'
import { useOpenOracleOperations } from '../../../features/open-oracle/hooks/useOpenOracleOperations.js'
import type { AccountState } from '../../../types/app.js'
import type { InjectedEthereum } from '../../../injectedEthereum.js'
import { createInjectedBackend } from '../../../lib/chainBackend.js'
import { createConnectedReadClient } from '../../../lib/clients.js'
import { formatOpenOracleFeePercentageInput, getOpenOracleSelectedReportActionMode } from '../../../features/open-oracle/lib/openOracle.js'
import type { OpenOracleView } from '../../../features/types.js'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, WETH_ADDRESS } from '../../../../../solidity/ts/testSupport/simulator/utils/constants'
import { addressString } from '../../../../../solidity/ts/testSupport/simulator/utils/bigint'
import { setupTestAccounts, ensureProxyDeployerDeployed } from '../../../../../solidity/ts/testSupport/simulator/utils/utilities'
import { AnvilWindowEthereum } from '../../../../../solidity/ts/testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../../../../../solidity/ts/testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../../../../../solidity/ts/testSupport/simulator/utils/clients'
import { ensureInfraDeployed } from '../../../../../solidity/ts/testSupport/simulator/utils/contracts/deployPeripherals'
import { ensureZoltarDeployed } from '../../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../../../lib/activeEnvironment.js'
import { formatCurrencyInputBalance } from '../../../lib/formatters.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'

setDefaultTimeout(TEST_TIMEOUT_MS)

const walletAddress = addressString(TEST_ADDRESSES[0])
const reportId = 1n
const initialReportPrice = 4n
const openOracleCreateParameters = {
	disputeDelay: 10,
	escalationHalt: 0n,
	exactToken1Report: 100n * 10n ** 18n,
	ethValue: 1100n,
	feePercentage: 100,
	multiplier: 100,
	protocolFee: 100,
	settlementTime: 60,
	settlerReward: 1000n,
	token1Address: addressString(GENESIS_REPUTATION_TOKEN),
	token2Address: getAddress(WETH_ADDRESS),
}

function createInjectedWalletShim(mockWindow: AnvilWindowEthereum, accountAddress: Address): InjectedEthereum {
	const request: InjectedEthereum['request'] = async parameters => {
		if (parameters.method === 'eth_accounts' || parameters.method === 'eth_requestAccounts') return [accountAddress] as never

		return (await mockWindow.request({ method: parameters.method, params: parameters.params })) as never
	}

	return {
		on: () => undefined,
		removeListener: () => undefined,
		request,
	}
}

function OpenOracleSectionHarness({ accountAddress, initialActiveView = 'create' }: { accountAddress: Address; initialActiveView?: OpenOracleView }) {
	const [activeView, setActiveView] = useState<OpenOracleView>(initialActiveView)
	const openOracle = useOpenOracleOperations({
		accountAddress,
		enabled: true,
		onTransactionFinished: () => undefined,
		onTransactionPresented: () => undefined,
		onTransactionRequested: () => undefined,
		onTransactionSubmitted: (_hash: Hash) => undefined,
		refreshState: async () => undefined,
	})
	const accountState: AccountState = {
		address: accountAddress,
		chainId: '0x1',
		ethBalance: 10n ** 30n,
		wethBalance: undefined,
	}

	return (
		<>
			<ViewTabs
				ariaLabel='Oracle report views'
				value={activeView}
				onChange={setActiveView}
				options={[
					{ label: 'Browse', value: 'browse' },
					{ label: 'Create', value: 'create' },
					{ label: 'Report Details', value: 'selected-report' },
				]}
			/>
			<OpenOracleSection
				activeView={activeView}
				accountState={accountState}
				loadingOpenOracleCreate={openOracle.loadingOpenOracleCreate}
				loadingOracleReport={openOracle.loadingOracleReport}
				onActiveViewChange={setActiveView}
				onApproveToken1={amount => void openOracle.approveToken1(amount)}
				onApproveToken2={amount => void openOracle.approveToken2(amount)}
				onCreateOpenOracleGame={() => void openOracle.createOpenOracleGame()}
				onDisputeReport={() => void openOracle.disputeReport()}
				onLoadOracleReport={reportIdInput => void openOracle.loadOracleReport(reportIdInput)}
				onOpenOracleCreateFormChange={update => openOracle.setOpenOracleCreateForm(current => ({ ...current, ...update }))}
				onOpenOracleFormChange={update => openOracle.setOpenOracleForm(current => ({ ...current, ...update }))}
				onRefreshPrice={openOracle.refreshPrice}
				onSettleReport={() => void openOracle.settleReport()}
				onSubmitInitialReport={() => void openOracle.submitInitialReport()}
				onWrapWethForInitialReport={() => void openOracle.wrapWethForInitialReport()}
				openOracleActiveAction={openOracle.openOracleActiveAction}
				openOracleCreateForm={openOracle.openOracleCreateForm}
				openOracleDisputeSubmission={openOracle.openOracleDisputeSubmission}
				openOracleError={openOracle.openOracleError}
				openOracleForm={openOracle.openOracleForm}
				openOracleInitialReportSubmission={openOracle.openOracleInitialReportSubmission}
				openOracleInitialReportState={openOracle.openOracleInitialReportState}
				openOracleReportDetails={openOracle.openOracleReportDetails}
				openOracleResult={openOracle.openOracleResult}
			/>
		</>
	)
}

function getSectionByTitle(name: string) {
	const heading = within(document.body).getByRole('heading', { level: 3, name })
	const section = heading.closest('section')
	if (!(section instanceof HTMLElement)) throw new Error(`Expected section for ${name}`)
	return section
}

function getApprovalSections() {
	return within(document.body)
		.getAllByRole('heading', { level: 4 })
		.filter(heading => heading.textContent?.trim().endsWith('Approval') === true)
		.map(heading => {
			const section = heading.closest('section')
			if (!(section instanceof HTMLElement)) throw new Error('Expected approval section container')
			return section
		})
}

function getApproveButton(section: HTMLElement) {
	const button = within(section)
		.getAllByRole('button')
		.find(candidate => candidate.textContent?.trim().startsWith('Approve') === true)
	if (!(button instanceof HTMLButtonElement)) throw new Error('Expected approve button')
	return button
}

function getRefreshReportButton() {
	const button = within(document.body).getByText('Refresh report', { selector: 'button' })
	if (!(button instanceof HTMLButtonElement)) throw new Error('Expected refresh report button')
	return button
}

async function setInputValue(label: string | RegExp, value: string, scope?: HTMLElement) {
	const input = within(scope ?? document.body).getByLabelText(label) as HTMLInputElement
	await act(() => {
		fireEvent.input(input, {
			target: { value },
		})
	})
	return input
}

async function clickElement(element: HTMLElement) {
	await act(() => {
		fireEvent.click(element)
	})
}

async function fillOpenOracleCreateForm() {
	await setInputValue('Token1 Address', openOracleCreateParameters.token1Address)
	await setInputValue('Token2 Address', openOracleCreateParameters.token2Address)
	await setInputValue('Exact Token1 Report', formatCurrencyInputBalance(openOracleCreateParameters.exactToken1Report))
	await setInputValue('Settler Reward', formatCurrencyInputBalance(openOracleCreateParameters.settlerReward))
	await setInputValue('ETH Value To Send', formatCurrencyInputBalance(openOracleCreateParameters.ethValue))
	await setInputValue('Fee Percentage', formatOpenOracleFeePercentageInput(BigInt(openOracleCreateParameters.feePercentage)))
	await setInputValue('Multiplier', openOracleCreateParameters.multiplier.toString())
	await setInputValue('Settlement Time', openOracleCreateParameters.settlementTime.toString())
	await setInputValue('Escalation Halt', formatCurrencyInputBalance(openOracleCreateParameters.escalationHalt))
	await setInputValue('Dispute Delay', openOracleCreateParameters.disputeDelay.toString())
	await setInputValue('Protocol Fee', formatOpenOracleFeePercentageInput(BigInt(openOracleCreateParameters.protocolFee)))
}

async function loadSelectedReportInUi() {
	const reportIdInput = await setInputValue('Report ID', reportId.toString())
	const reportIdField = reportIdInput.closest('.field')
	if (!(reportIdField instanceof HTMLElement)) throw new Error('Expected report ID field wrapper')
	const reportControlButton = reportIdField.querySelector('button')
	if (!(reportControlButton instanceof HTMLButtonElement)) throw new Error('Expected report ID control button')
	await clickElement(reportControlButton)
	await waitFor(() => getSectionByTitle('Report Actions'))
}

async function createSubmittedOpenOracleReport(writeClient: WriteClient, readClient: ReturnType<typeof createConnectedReadClient>) {
	const openOracleAddress = getOpenOracleAddress()
	await createOpenOracleReportInstance(writeClient, openOracleCreateParameters)
	const reportDetails = await loadOpenOracleReportDetails(readClient, openOracleAddress, reportId)
	const amount2 = reportDetails.exactToken1Report / initialReportPrice

	await approveErc20(writeClient, reportDetails.token1, openOracleAddress, reportDetails.exactToken1Report, 'approveToken1')
	await approveErc20(writeClient, reportDetails.token2, openOracleAddress, amount2, 'approveToken2')
	await wrapWeth(writeClient, amount2)
	await submitInitialOracleReport(writeClient, openOracleAddress, reportId, reportDetails.exactToken1Report, amount2, reportDetails.stateHash)

	return {
		openOracleAddress,
	}
}

async function waitForLatestAction(actionName: string) {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (within(document.body).queryAllByText(actionName).length > 0) return
		await new Promise(resolve => {
			setTimeout(resolve, 50)
		})
	}
}

describe.serial('OpenOracleSection integration', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let resetActiveEnvironment: (() => void) | undefined
	let restoreDomEnvironment: (() => void) | undefined
	let uiReadClient: ReturnType<typeof createConnectedReadClient>
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeAll(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureProxyDeployerDeployed(client)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		resetActiveEnvironment?.()
		resetActiveEnvironmentForTesting()
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		Reflect.set(domEnvironment.window, 'ethereum', createInjectedWalletShim(mockWindow, walletAddress))
		resetActiveEnvironment = installActiveEnvironmentForTesting(createInjectedBackend())
		uiReadClient = createConnectedReadClient()
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		resetActiveEnvironment?.()
		resetActiveEnvironment = undefined
		resetActiveEnvironmentForTesting()
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('creates, opens, approves, wraps, and submits an initial report through the UI', async () => {
		const renderedComponent = await renderIntoDocument(<OpenOracleSectionHarness accountAddress={walletAddress} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await fillOpenOracleCreateForm()

		await clickElement(within(document.body).getByRole('button', { name: 'Create Standalone Oracle Game' }))

		await waitForLatestAction('createReportInstance')
		await waitFor(async () => {
			const createdReport = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)
			expect(createdReport.reportId).toBe(reportId)
		})
		const reportDetails = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)

		await clickElement(within(document.body).getByRole('button', { name: 'Browse' }))
		await waitFor(() => {
			expect(
				within(document.body).getByRole('heading', {
					name: `${reportDetails.token1Symbol} / ${reportDetails.token2Symbol} · Report #${reportId.toString()}`,
				}),
			).not.toBeNull()
		})
		await clickElement(within(document.body).getByRole('button', { name: 'Open report' }))

		await waitFor(() => getSectionByTitle('Report Details'))
		let economicsSummary: HTMLElement | undefined
		await waitFor(() => {
			const summary = Array.from(document.body.querySelectorAll('summary')).find(summary => summary.textContent?.trim() === 'Economics')
			if (!(summary instanceof HTMLElement)) throw new Error('Expected economics accordion summary')
			economicsSummary = summary
		})
		if (economicsSummary === undefined) throw new Error('Expected economics accordion summary')
		await clickElement(economicsSummary)
		await waitFor(() => {
			expect(document.body.textContent?.includes(`Current Amount 1 (${reportDetails.token1Symbol})`)).toBe(true)
			expect(document.body.textContent?.includes(`Current Amount 2 (${reportDetails.token2Symbol})`)).toBe(true)
		})
		await waitFor(() => {
			expect(within(document.body).getByRole('button', { name: 'Initial Report' })).not.toBeNull()
		})
		await clickElement(within(document.body).getByRole('button', { name: 'Initial Report' }))
		const initialReportDialog = within(document.body).getByRole('dialog', { name: 'Submit Initial Report' })
		await waitFor(() => {
			expect(within(initialReportDialog).getByLabelText(/^Price \(/)).not.toBeNull()
		})
		expect(within(initialReportDialog).queryByRole('heading', { level: 2, name: 'Open Oracle' })).toBeNull()
		expect(within(initialReportDialog).queryByRole('heading', { level: 3, name: 'Report Details' })).toBeNull()
		expect(within(initialReportDialog).queryByRole('heading', { level: 3, name: 'Report Actions' })).toBeNull()
		await setInputValue(/^Price \(/, initialReportPrice.toString())

		const openOracleAddress = getOpenOracleAddress()
		const expectedAmount2 = reportDetails.exactToken1Report / initialReportPrice

		await waitFor(() => {
			const [currentToken1ApprovalSection, currentToken2ApprovalSection] = getApprovalSections()
			if (currentToken1ApprovalSection === undefined || currentToken2ApprovalSection === undefined) throw new Error('Expected both token approval sections to be rendered')
			expect(getApproveButton(currentToken1ApprovalSection).disabled).toBe(false)
			expect(getApproveButton(currentToken2ApprovalSection).disabled).toBe(false)
		})

		const [token1ApprovalSection, token2ApprovalSection] = getApprovalSections()
		if (token1ApprovalSection === undefined || token2ApprovalSection === undefined) throw new Error('Expected both token approval sections to be rendered')

		await clickElement(getApproveButton(token1ApprovalSection))
		await waitForLatestAction('approveToken1')
		await waitFor(async () => {
			expect(await loadErc20Allowance(uiReadClient, reportDetails.token1, walletAddress, openOracleAddress)).toBe(reportDetails.exactToken1Report)
		})

		const refreshedApprovalSections = getApprovalSections()
		const refreshedToken2ApprovalSection = refreshedApprovalSections[1]
		if (refreshedToken2ApprovalSection === undefined) throw new Error('Expected the second token approval section to remain rendered')

		await clickElement(getApproveButton(refreshedToken2ApprovalSection))
		await waitForLatestAction('approveToken2')
		await waitFor(async () => {
			expect(await loadErc20Allowance(uiReadClient, reportDetails.token2, walletAddress, openOracleAddress)).toBe(expectedAmount2)
		})

		await waitFor(() => {
			const documentQueries = within(document.body)
			const submitButton = documentQueries.getByRole('button', { name: 'Submit Initial Report' }) as HTMLButtonElement
			const wrapButton = documentQueries.getByRole('button', { name: 'Wrap needed ETH to WETH' }) as HTMLButtonElement
			expect(submitButton.disabled).toBe(true)
			expect(wrapButton.disabled).toBe(false)
			expect(documentQueries.getByText(/more WETH for this report/i)).not.toBeNull()

			const wrapActionRow = wrapButton.closest('.actions')
			expect(wrapActionRow).not.toBeNull()
			expect(wrapActionRow).toBe(submitButton.closest('.actions'))
			const actionButtons = Array.from(wrapActionRow?.querySelectorAll('button') ?? [])
			expect(actionButtons.indexOf(wrapButton)).toBeLessThan(actionButtons.indexOf(submitButton))
		})

		const wethBalanceBeforeWrap = await loadErc20Balance(uiReadClient, reportDetails.token2, walletAddress)
		expect(wethBalanceBeforeWrap).toBe(0n)

		await clickElement(within(document.body).getByRole('button', { name: 'Wrap needed ETH to WETH' }))
		await waitFor(async () => {
			expect(await loadErc20Balance(uiReadClient, reportDetails.token2, walletAddress)).toBe(expectedAmount2)
		})

		await waitFor(() => {
			const submitButton = within(document.body).getByRole('button', { name: 'Submit Initial Report' }) as HTMLButtonElement
			expect(submitButton.disabled).toBe(false)
		})

		await clickElement(within(document.body).getByRole('button', { name: 'Submit Initial Report' }))
		await waitForLatestAction('submitInitialReport')
		await waitFor(() => {
			expect(within(document.body).getByText('Pending')).not.toBeNull()
		})

		await waitFor(async () => {
			const submittedReport = await loadOpenOracleReportDetails(uiReadClient, openOracleAddress, reportId)
			expect(submittedReport.currentReporter).not.toBe(zeroAddress)
			expect(submittedReport.currentAmount1).toBe(reportDetails.exactToken1Report)
			expect(submittedReport.currentAmount2).toBe(expectedAmount2)
			expect(submittedReport.reportTimestamp > 0n).toBe(true)
		})
	})

	test('disables dispute and enables settle after the settlement window elapses', async () => {
		const { openOracleAddress } = await createSubmittedOpenOracleReport(client, uiReadClient)
		const renderedComponent = await renderIntoDocument(<OpenOracleSectionHarness accountAddress={walletAddress} initialActiveView='selected-report' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await loadSelectedReportInUi()

		const submittedReport = await loadOpenOracleReportDetails(uiReadClient, openOracleAddress, reportId)
		const submittedClock = submittedReport.timeType ? submittedReport.currentTime : submittedReport.currentBlockNumber
		const settleOnlyClock = submittedReport.reportTimestamp + submittedReport.settlementTime + 1n
		const advanceTimeBy = settleOnlyClock > submittedClock ? settleOnlyClock - submittedClock : 1n

		await mockWindow.advanceTime(advanceTimeBy)
		await clickElement(getRefreshReportButton())
		await waitFor(async () => {
			const refreshedReport = await loadOpenOracleReportDetails(uiReadClient, openOracleAddress, reportId)
			expect(getOpenOracleSelectedReportActionMode(refreshedReport)).toBe('settle')
		})

		await clickElement(within(document.body).getByRole('button', { name: 'Settle Report' }))
		await waitFor(() => {
			const dialog = within(document.body).getByRole('dialog')
			const settleButton = within(dialog).getByRole('button', { name: 'Settle Report' }) as HTMLButtonElement
			expect(within(document.body).queryByRole('button', { name: 'Dispute & Swap' })).toBeNull()
			expect(settleButton.disabled).toBe(false)
			expect(within(document.body).queryByText('Dispute window closed. Settle Report instead.')).toBeNull()
		})
	})
})
