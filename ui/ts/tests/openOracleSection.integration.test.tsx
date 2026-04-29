/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { fireEvent, waitFor, within } from '@testing-library/dom'
import { act } from 'preact/test-utils'
import type { Address, Hash } from 'viem'
import { zeroAddress } from 'viem'
import { OpenOracleSection } from '../components/OpenOracleSection.js'
import { getOpenOracleAddress, loadErc20Allowance, loadErc20Balance, loadOpenOracleReportDetails } from '../contracts.js'
import { useOpenOracleOperations } from '../hooks/useOpenOracleOperations.js'
import type { AccountState } from '../types/app.js'
import type { InjectedEthereum } from '../injectedEthereum.js'
import { createConnectedReadClient } from '../lib/clients.js'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, WETH_ADDRESS } from '../../../solidity/ts/testsuite/simulator/utils/constants'
import { addressString } from '../../../solidity/ts/testsuite/simulator/utils/bigint'
import { setupTestAccounts, ensureProxyDeployerDeployed } from '../../../solidity/ts/testsuite/simulator/utils/utilities'
import { AnvilWindowEthereum } from '../../../solidity/ts/testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../../../solidity/ts/testsuite/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../../../solidity/ts/testsuite/simulator/utils/viem'
import { ensureInfraDeployed } from '../../../solidity/ts/testsuite/simulator/utils/contracts/deployPeripherals'
import { ensureZoltarDeployed } from '../../../solidity/ts/testsuite/simulator/utils/contracts/zoltar'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

setDefaultTimeout(TEST_TIMEOUT_MS)

const walletAddress = addressString(TEST_ADDRESSES[0])
const reportId = 1n

function createInjectedWalletShim(mockWindow: AnvilWindowEthereum, accountAddress: Address): InjectedEthereum {
	const request: InjectedEthereum['request'] = async parameters => {
		if (parameters.method === 'eth_accounts' || parameters.method === 'eth_requestAccounts') {
			return [accountAddress] as never
		}

		return (await mockWindow.request({ method: parameters.method, params: parameters.params })) as never
	}

	return {
		on: () => undefined,
		removeListener: () => undefined,
		request,
	}
}

function OpenOracleSectionHarness({ accountAddress }: { accountAddress: Address }) {
	const openOracle = useOpenOracleOperations({
		accountAddress,
		onTransaction: (_hash: Hash) => undefined,
		onTransactionFinished: () => undefined,
		onTransactionRequested: () => undefined,
		onTransactionSubmitted: (_hash: Hash) => undefined,
		refreshState: async () => undefined,
	})
	const accountState: AccountState = {
		address: accountAddress,
		chainId: '0x1',
		ethBalance: undefined,
		wethBalance: undefined,
	}

	return (
		<OpenOracleSection
			accountState={accountState}
			initialView='create'
			loadingOpenOracleCreate={openOracle.loadingOpenOracleCreate}
			loadingOracleReport={openOracle.loadingOracleReport}
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
			openOracleError={openOracle.openOracleError}
			openOracleForm={openOracle.openOracleForm}
			openOracleInitialReportState={openOracle.openOracleInitialReportState}
			openOracleReportDetails={openOracle.openOracleReportDetails}
			openOracleResult={openOracle.openOracleResult}
		/>
	)
}

function getEntityCardByTitle(name: string) {
	const heading = within(document.body).getByRole('heading', { level: 3, name })
	const card = heading.closest('article')
	if (!(card instanceof HTMLElement)) {
		throw new Error(`Expected entity card for ${name}`)
	}
	return card
}

function getApprovalSections(selectedReportCard: HTMLElement) {
	return within(selectedReportCard)
		.getAllByRole('heading', { level: 4 })
		.filter(heading => heading.textContent?.trim().endsWith('Approval') === true)
		.map(heading => {
			const section = heading.closest('.entity-card-subsection')
			if (!(section instanceof HTMLElement)) {
				throw new Error('Expected approval section container')
			}
			return section
		})
}

function getApproveButton(section: HTMLElement) {
	const button = within(section)
		.getAllByRole('button')
		.find(candidate => candidate.textContent?.trim().startsWith('Approve') === true)
	if (!(button instanceof HTMLButtonElement)) {
		throw new Error('Expected approve button')
	}
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

async function waitForLatestAction(actionName: string) {
	await waitFor(() => {
		expect(within(document.body).getAllByText(actionName).length).toBeGreaterThan(0)
	})
}

describe.serial('OpenOracleSection integration', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let restoreDomEnvironment: (() => void) | undefined
	let uiReadClient: ReturnType<typeof createConnectedReadClient>
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureProxyDeployerDeployed(client)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)

		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		const injectedWindow = domEnvironment.window as unknown as Window & { ethereum?: InjectedEthereum }
		injectedWindow.ethereum = createInjectedWalletShim(mockWindow, walletAddress)
		uiReadClient = createConnectedReadClient()
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('creates, opens, approves, wraps, and submits an initial report through the UI', async () => {
		const renderedComponent = await renderIntoDocument(<OpenOracleSectionHarness accountAddress={walletAddress} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await setInputValue('Token1 Address', addressString(GENESIS_REPUTATION_TOKEN))
		await setInputValue('Token2 Address', WETH_ADDRESS)
		await setInputValue('Exact Token1 Report', '100000000000000000000')
		await setInputValue('Settler Reward', '1000')
		await setInputValue('ETH Value To Send', '1100')
		await setInputValue('Fee Percentage', '100')
		await setInputValue('Multiplier', '100')
		await setInputValue('Settlement Time', '60')
		await setInputValue('Escalation Halt', '0')
		await setInputValue('Dispute Delay', '10')
		await setInputValue('Protocol Fee', '100')

		await clickElement(within(document.body).getByRole('button', { name: 'Create Open Oracle Game' }))

		await waitForLatestAction('createReportInstance')
		await waitFor(async () => {
			const createdReport = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)
			expect(createdReport.reportId).toBe(reportId)
		})

		await clickElement(within(document.body).getByRole('button', { name: 'Browse' }))
		await waitFor(() => {
			expect(within(document.body).getByText(`Report #${reportId.toString()}`)).not.toBeNull()
		})
		await clickElement(within(document.body).getByRole('button', { name: 'Open report' }))

		const selectedReportCard = await waitFor(() => getEntityCardByTitle('Selected Report'))
		await waitFor(() => {
			expect(within(document.body).getByText('Initial Report')).not.toBeNull()
		})
		await setInputValue(/^Price \(/, '4', selectedReportCard)

		const reportDetails = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)
		const openOracleAddress = getOpenOracleAddress()
		const expectedAmount2 = reportDetails.exactToken1Report / 4n

		await waitFor(() => {
			const [currentToken1ApprovalSection, currentToken2ApprovalSection] = getApprovalSections(getEntityCardByTitle('Selected Report'))
			if (currentToken1ApprovalSection === undefined || currentToken2ApprovalSection === undefined) {
				throw new Error('Expected both token approval sections to be rendered')
			}
			expect(getApproveButton(currentToken1ApprovalSection).disabled).toBe(false)
			expect(getApproveButton(currentToken2ApprovalSection).disabled).toBe(false)
		})

		const [token1ApprovalSection, token2ApprovalSection] = getApprovalSections(selectedReportCard)
		if (token1ApprovalSection === undefined || token2ApprovalSection === undefined) {
			throw new Error('Expected both token approval sections to be rendered')
		}

		await clickElement(getApproveButton(token1ApprovalSection))
		await waitForLatestAction('approveToken1')
		await waitFor(async () => {
			expect(await loadErc20Allowance(uiReadClient, reportDetails.token1, walletAddress, openOracleAddress)).toBe(reportDetails.exactToken1Report)
		})

		const refreshedApprovalSections = getApprovalSections(getEntityCardByTitle('Selected Report'))
		const refreshedToken2ApprovalSection = refreshedApprovalSections[1]
		if (refreshedToken2ApprovalSection === undefined) {
			throw new Error('Expected the second token approval section to remain rendered')
		}

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

			const wrapActionRow = wrapButton.parentElement
			expect(wrapActionRow).not.toBeNull()
			expect(wrapActionRow).toBe(submitButton.parentElement)
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
})
