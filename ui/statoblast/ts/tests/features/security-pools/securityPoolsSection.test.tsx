import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createMulticallStub, getContractFunctionName } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { getOpenOracleGameTuple } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { resetRoutingForTesting } from '@zoltar/ui-core-shared/navigation/routing.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/wallet/network.js'
import { invalidateAppData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { localEntityScopeForNetwork } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { SecurityPoolsSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolsSection.js'
import { initialDeploymentDraft } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/creation.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/securityPoolCapital.js'
import * as priceCopy from '@zoltar/ui-statoblast-shared/copy/securityPoolPrice.js'
import { poolTabLabels, returnFundsOnly } from '@zoltar/ui-statoblast-shared/copy/securityPoolPage.js'
import { rememberSecurityPoolPriceReport, securityPoolPriceReportCache } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPrice.js'
import { capitalSnapshot, owner, securityPool } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'
import { priceEscrow, priceFeed, priceFixture, priceOracle, priceWeth } from './priceFixture.js'

const lifecycle = installDomTestLifecycle({
	url: `https://example.test/#/security-pools?securityPool=${securityPool}&owner=${owner}`,
	afterTest: () => {
		resetActiveEnvironmentForTesting()
		resetRoutingForTesting()
	},
})
const parameters = { accountAddress: owner, onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }

const poolPage = { kind: 'pool', pool: securityPool, tab: 'capital' } as const
const renderSecurityPools = async (tab: 'capital' | 'price' | 'liquidations' = 'capital') => {
	installStatoblastRouting()
	window.history.replaceState({}, '', tab === 'capital' ? `#/pool/${securityPool}` : `#/pool/${securityPool}/${tab}`)
	const view = await renderIntoDocument(<SecurityPoolsSection page={{ ...poolPage, tab }} parameters={parameters} walletConnected enabled environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
	return view
}
const sectionTitled = (container: Element, title: string) => [...container.querySelectorAll('section')].find(section => section.querySelector('h3')?.textContent === title)

test('walletless Capital shows the pool without reading a zero-address position and keeps explicit positions viewable', async () => {
	installStatoblastRouting()
	const source = capitalClient()
	const addressReads: Address[] = []
	const client = source.client.extend(() => ({
		getCode: async (request: Parameters<typeof source.client.getCode>[0]) => {
			addressReads.push(request.address)
			return await source.client.getCode(request)
		},
		getBalance: async ({ address }: { address: Address }) => {
			addressReads.push(address)
			return 0n
		},
	}))
	installActiveEnvironmentForTesting({ ...source.backend, createReadClient: () => client })
	const hash = `#/pool/${securityPool}`
	window.history.replaceState({}, '', hash)
	const element = <SecurityPoolsSection page={{ kind: 'pool', pool: securityPool, tab: 'capital' }} parameters={{ ...parameters, accountAddress: undefined }} walletConnected={false} enabled environmentKey={0} activeUniverseId={0n} />
	const view = lifecycle.trackRendered(await renderIntoDocument(element))
	await waitFor(() => expect(view.container.querySelector('.statoblast-pool-state')?.textContent).toContain('Active'))
	expect(addressReads).not.toContain(zeroAddress)
	expect(source.reads.some(read => read.args?.includes(zeroAddress))).toBe(false)
	expect(view.container.textContent).toContain('Connect a wallet to see your position.')
	expect(view.container.textContent).not.toContain('Your position')

	await act(() => {
		window.history.replaceState({}, '', `${hash}?owner=${owner}`)
		window.dispatchEvent(new Event('hashchange'))
	})
	await waitFor(() => expect(source.reads.some(read => read.name === 'ownerAccount' && read.args?.includes(owner))).toBe(true))
	await waitFor(() => expect(view.container.querySelector('.statoblast-capital-position h3')?.textContent).toBe('Position'))
	expect(view.container.textContent).not.toContain('Connect a wallet to see your position.')
})

test('Capital keeps the connected wallet position readable with a switch-network reason when writes are unavailable', async () => {
	installStatoblastRouting()
	const source = capitalClient()
	source.install()
	window.history.replaceState({}, '', `#/pool/${securityPool}`)
	const props = { page: { kind: 'pool', pool: securityPool, tab: 'capital' }, enabled: true, environmentKey: 0, activeUniverseId: 0n, walletConnected: true, walletAddress: owner } as const
	const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolsSection {...props} parameters={parameters} />))
	await waitFor(() => expect(view.container.querySelector('.statoblast-capital-position h3')?.textContent).toBe('Your position'))
	await act(() => render(<SecurityPoolsSection {...props} parameters={{ ...parameters, accountAddress: undefined }} />, view.container))
	expect(view.container.querySelector('.statoblast-capital-position h3')?.textContent).toBe('Your position')
	const claim = [...view.container.querySelectorAll('button')].find(button => button.textContent === copy.claim)
	expect(claim?.disabled).toBe(true)
	const reasonId = claim?.getAttribute('aria-describedby')
	expect(reasonId === null || reasonId === undefined ? undefined : document.getElementById(reasonId)?.textContent).toBe(getWrongNetworkReason())
})

test('walletless fork page shows public context and keeps personal reads and transactions locked', async () => {
	installStatoblastRouting()
	const source = capitalClient(capitalSnapshot({ forkTime: 900n, forkChoiceDeadline: 2_000n }))
	installActiveEnvironmentForTesting(source.backend)
	window.history.replaceState({}, '', `#/pool/${securityPool}/fork`)
	const view = lifecycle.trackRendered(
		await renderIntoDocument(
			<SecurityPoolsSection
				page={{ kind: 'pool', pool: securityPool, tab: 'fork' }}
				parameters={{ ...parameters, accountAddress: undefined }}
				walletConnected={false}
				enabled
				environmentKey={0}
				activeUniverseId={0n}
				forkRecapitalizationDeadline={3_000n}
				forkQuestion={{ answerUnit: '', createdAt: 1n, description: '', displayValueMax: 100n, displayValueMin: 0n, endTime: 800n, exists: true, marketType: 'binary', numTicks: 2n, outcomeLabels: ['Yes', 'No'], questionId: '0x07', startTime: 1n, title: 'Will this resolve?' }}
			/>,
		),
	)
	await waitFor(() => expect(view.container.querySelector('.statoblast-fork-diagram')).not.toBeNull())
	expect(view.container.querySelector('.statoblast-fork-diagram-stays .statoblast-fork-diagram-amounts')?.textContent).toBeUndefined()
	expect([...view.container.querySelectorAll('.statoblast-fork-diagram-branches li > strong')].map(node => node.textContent)).toEqual(['Yes', 'No', 'Invalid'])
	expect(view.container.querySelector('.statoblast-fork-choice-deadline')?.textContent).toContain('Choose a branch by')
	expect(view.container.querySelectorAll('.statoblast-branch-recapitalization')).toHaveLength(1)
	expect(view.container.querySelector('.statoblast-branch-recapitalization')?.textContent).toContain('Recapitalization deadline')
	const steps = [...view.container.querySelectorAll('.statoblast-fork-workflow > li')]
	expect(steps).toHaveLength(7)
	for (const step of steps) {
		expect(step.textContent).toContain('Connect a wallet')
		expect(step.querySelector('button')?.disabled).toBe(true)
	}
	const input = view.container.querySelector<HTMLInputElement>('.statoblast-recovery-picker input')
	const form = input?.form
	if (input === null || form === null || form === undefined) throw new Error('Recovery question ID input unavailable')
	await act(() => {
		input.value = '7'
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
	await act(() => {
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
	})
	expect(view.container.textContent).toContain('Recovery for share holders')
	expect(view.container.textContent).not.toContain('Checking recovery rights…')
	expect(source.reads.some(read => read.args?.includes(zeroAddress) || read.name === 'choices' || read.name === 'balanceOfSecurityPoolRecoveryRights')).toBe(false)
})
const reduction = (container: Element) => {
	const section = container.querySelector('section:has([id$="-reduce"])')
	if (section === null) throw new Error('Reduce commitment section missing')
	return section
}

test('deploy and setup shows all six persistent transaction controls in the same workflow', async () => {
	installStatoblastRouting()
	window.history.replaceState({}, '', '#/deploy-pool')
	capitalClient().install()
	const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolsSection deploying parameters={parameters} walletConnected enabled environmentKey={0} activeUniverseId={0n} />))
	const step = [...view.container.querySelectorAll('button')].find(button => button.textContent?.includes('Deploy and set up'))
	if (step === undefined) throw new Error('Missing deployment step')
	await act(() => step.click())
	const workflow = view.container.querySelector('ol[aria-label="Deployment transactions"]')
	const transactions = [...(workflow?.querySelectorAll('button.tx-action-button') ?? [])]
	expect(transactions.map(button => button.textContent)).toEqual(['Prepare question rules', 'Deploy security pool', ...copy.prepareStages])
	expect(transactions.map(button => button.hasAttribute('disabled'))).toEqual([false, true, true, true, true, true])
})

test('a hashless deployment offers a way to check the wallet again', async () => {
	installStatoblastRouting()
	window.history.replaceState({}, '', '#/deploy-pool')
	const source = capitalClient()
	const { network, persistence } = localEntityScopeForNetwork(source.backend.profile, 'statoblast', 'pool')
	const storage = persistence === 'session' ? window.sessionStorage : window.localStorage
	storage.setItem(`zoltar-ui:statoblast:deployment:v1:${network}:${owner.toLowerCase()}`, JSON.stringify({ draft: initialDeploymentDraft('0'), pending: { id: 'waiting-deployment', step: 'rules', nonce: '0' } }))
	let nonceChecks = 0
	installActiveEnvironmentForTesting({
		...source.backend,
		createReadClient: () =>
			source.client.extend(() => ({
				getTransactionCount: async () => {
					nonceChecks++
					return 0n
				},
			})),
	})
	const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolsSection deploying parameters={parameters} walletConnected enabled environmentKey={0} activeUniverseId={0n} />))
	const findCheck = () => [...view.container.querySelectorAll('button')].find(button => button.textContent === 'Check again' && !button.disabled)
	await waitFor(() => expect(findCheck()).toBeDefined(), { timeout: 1000 })
	const checksBeforeClick = nonceChecks
	await act(() => findCheck()?.click())
	await waitFor(() => expect(nonceChecks).toBeGreaterThan(checksBeforeClick))
})

test('completed setup preserves the four transaction controls in their original order with completion reasons', async () => {
	const source = capitalClient()
	source.setSetupStage(2n)
	source.install()
	const view = await renderSecurityPools()
	await waitFor(() => expect(view.container.textContent).toContain(copy.prepareProgress(2)))
	const setup = sectionTitled(view.container, copy.prepareTitle)
	if (setup === undefined) throw new Error('Setup section missing')
	const buttons = [...setup.querySelectorAll('button')]
	expect(buttons.map(button => button.textContent)).toEqual(copy.prepareStages)
	expect(buttons.map(button => button.disabled)).toEqual([true, true, false, true])

	source.setSetupStage(4n)
	await act(() => invalidateAppData())
	await waitFor(() => expect(setup.textContent).toContain(copy.prepareProgress(4)))
	expect(setup.textContent).not.toContain(copy.prepareHint)
	expect(setup.isConnected).toBe(true)
	expect([...setup.querySelectorAll('button')]).toEqual(buttons)
	expect(buttons.map(button => button.disabled)).toEqual([true, true, true, true])
	expect(setup.textContent?.match(/This setup stage is complete\./g)).toHaveLength(4)
	expect(view.container.textContent?.split(copy.prepareProgress(4))).toHaveLength(2)
	expect(view.container.textContent).not.toContain('Auction reserve')
	expect(view.container.textContent).not.toContain('Execution reserve')
})

test('authenticated refresh preserves position controls while disabling transactions until fresh data resolves', async () => {
	const source = capitalClient()
	source.install()
	const view = await renderSecurityPools()
	await waitFor(() => expect(view.container.querySelector('section:has([id$="-reduce"]) input')).not.toBeNull())
	const position = reduction(view.container)
	const inputs = [...position.querySelectorAll('input')]
	const buttons = [...position.querySelectorAll('button')]
	expect(inputs).toHaveLength(1)
	expect(buttons).toHaveLength(1)
	await act(() => render(<SecurityPoolsSection page={poolPage} parameters={parameters} walletConnected enabled={false} environmentKey={0} activeUniverseId={0n} />, view.container))
	expect(position.isConnected).toBe(true)
	expect([...position.querySelectorAll('input')]).toEqual(inputs)
	expect([...position.querySelectorAll('button')]).toEqual(buttons)
	expect(buttons.every(button => button.disabled)).toBe(true)
	expect(position.textContent).toContain(copy.readUnavailable)
	expect(inputs.every(input => input.disabled)).toBe(true)
	await act(() => render(<SecurityPoolsSection page={poolPage} parameters={parameters} walletConnected enabled environmentKey={0} activeUniverseId={0n} />, view.container))
	await waitFor(() => expect(buttons.some(button => !button.disabled)).toBe(true))
	expect(position.isConnected).toBe(true)
})

test('a pending retirement shows its locked request without an editable form', async () => {
	const snapshot = capitalSnapshot()
	const source = capitalClient({ ...snapshot, positions: snapshot.positions.map(position => ({ ...position, batch: 1n, remainingCommitment: 0n })) })
	source.install()
	const view = await renderSecurityPools()
	await waitFor(() => expect(view.container.querySelector('.statoblast-queue-totals')).not.toBeNull())
	const position = reduction(view.container)
	expect(position.querySelectorAll('input')).toHaveLength(0)
	expect([...position.querySelectorAll('button')].map(button => button.textContent?.trim())).not.toContain(copy.retire)
	expect(position.textContent).not.toContain(copy.remainingCommitment)
})

test('a forked origin is announced on its field and stated once beside the deploy actions', async () => {
	installStatoblastRouting()
	window.history.replaceState({}, '', '#/deploy-pool')
	const source = capitalClient()
	source.setRead('getForkTime', 1n)
	source.install()
	const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolsSection deploying parameters={parameters} walletConnected enabled environmentKey={0} activeUniverseId={0n} />))
	const originField = Array.from(view.container.querySelectorAll('.field')).find(field => field.querySelector('label')?.textContent === 'Origin universe ID')
	await waitFor(() => expect(originField?.querySelector('input')?.getAttribute('aria-invalid')).toBe('true'))
	expect(originField?.querySelector('[aria-live="polite"]')?.textContent).toContain('This universe has forked.')
	const setup = view.container.querySelector<HTMLButtonElement>('.statoblast-deploy-progress li:last-child button')
	if (setup === null) throw new Error('Deploy step not found')
	await act(() => setup.click())
	const form = view.container.querySelector('.security-pool-creation-form')
	const reasons = form?.querySelectorAll('.shared-action-reason')
	expect(reasons).toHaveLength(1)
	const reason = reasons?.item(0)
	expect(reason?.textContent).toBe('The origin universe has forked.')
	const reasonId = reason?.firstElementChild?.id
	const buttons = ['Prepare question rules', 'Deploy security pool'].map(name => Array.from(form?.querySelectorAll('button') ?? []).find(candidate => candidate.textContent === name))
	for (const button of buttons) {
		expect(button?.disabled).toBe(true)
		expect(button?.getAttribute('aria-describedby')).toBe(reasonId ?? null)
	}
})

test('an unforked pool with an expired price can fund a price report from its REP price tab', async () => {
	const fixture = priceFixture(capitalSnapshot({ priceValid: false, priceValidUntil: 900n }))
	fixture.set(priceFeed, 'universeId', 0n)
	const view = await renderSecurityPools('price')
	await waitFor(() => expect(view.container.textContent).toContain('Wallet WETH'))
	const input = [...view.container.querySelectorAll('input')].find(candidate => candidate.closest('.field')?.querySelector('label')?.textContent?.includes(priceCopy.priceDraftLabel('WETH')))
	if (input === undefined) throw new Error('Missing REP price input')
	await act(() => {
		input.value = '2'
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
	const button = (label: string) => [...view.container.querySelectorAll('button')].find(button => button.textContent === label)
	await waitFor(() => expect(button(priceCopy.wrap)?.disabled).toBe(false))
	expect(button(priceCopy.scopes.universe.request)?.disabled).toBe(true)
	expect(view.container.textContent).toContain(priceCopy.insufficientWeth)
})

test.each([undefined, owner] as const)('a forked pool on Capital checks other funders’ known reports regardless of wallet %s', async wallet => {
	installStatoblastRouting()
	const fixture = priceFixture(capitalSnapshot({ forkTime: 100n, priceFeed }))
	const olderEscrow = getAddress('0x0000000000000000000000000000000000000085')
	const foreignEscrow = getAddress('0x0000000000000000000000000000000000000086')
	let olderCredit = 20n
	let failFundingRead = false
	let failedReads = 0
	const readReportIds: bigint[] = []
	const client = fixture.client.extend(() => ({
		multicall: createMulticallStub(async request =>
			request.contracts.map(contract => {
				const name = getContractFunctionName(contract)
				const args: unknown = Reflect.get(contract, 'args')
				const first: unknown = Array.isArray(args) ? args[0] : undefined
				switch (name) {
					case 'pendingReportId':
						return 0n
					case 'sponsorOperationReport':
						expect(first).toBe(wallet)
						return 8n
					case 'openOracle':
						return priceOracle
					case 'reportCandidates':
						if (typeof first !== 'bigint') throw new Error('Expected report ID')
						readReportIds.push(first)
						if (first === 11n) return [foreignEscrow, priceFeed, 1n]
						return [first === 8n ? olderEscrow : priceEscrow, owner, 1n]
					case 'tokenHolder':
						if (failFundingRead) {
							failedReads++
							throw new Error('RPC unavailable')
						}
						return first === foreignEscrow ? olderCredit : 1n
					case 'storedGame': {
						const callbackContract = first === 8n ? olderEscrow : priceEscrow
						return getOpenOracleGameTuple({ ...fixture.game, settlementTimestamp: 1100n, callbackContract: first === 11n ? foreignEscrow : callbackContract })
					}
					default:
						throw new Error(`Unexpected multicall ${name}`)
				}
			}),
		),
	}))
	installActiveEnvironmentForTesting({ ...fixture.backend, createReadClient: () => client })
	const savedBlock = { number: 9n, timestamp: 1100n }
	if (wallet === undefined) {
		const oldPreview = securityPoolPriceReportCache(fixture.backend.profile, securityPool, 0n, owner, 8n)
		oldPreview.write({ reportId: 8n, sponsor: owner, outcome: 1n, state: { settled: true }, reportedAt: undefined, eligibleAt: 1100n, bounty: undefined, baseFeePerGas: undefined, maxSettlementBaseFee: 1n, wethCredit: 19n, repCredit: 0n, collateralToken: priceWeth }, savedBlock)
	}
	rememberSecurityPoolPriceReport(fixture.backend.profile, securityPool, 0n, owner, 9n, savedBlock)
	rememberSecurityPoolPriceReport(fixture.backend.profile, securityPool, 0n, priceFeed, 11n, savedBlock)
	rememberSecurityPoolPriceReport(fixture.backend.profile, securityPool, 7n, owner, 12n, savedBlock)
	const view = await renderIntoDocument(<SecurityPoolsSection page={{ kind: 'pool', pool: securityPool, tab: 'capital' }} parameters={{ ...parameters, accountAddress: wallet }} walletConnected={wallet !== undefined} enabled environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
	const priceTab = () => [...view.container.querySelectorAll('a')].find(link => link.hash.includes('/price'))
	await waitFor(() => expect(priceTab()?.textContent).toContain(returnFundsOnly))
	expect([...view.container.querySelectorAll('.statoblast-pool-tab-select option')].map(option => option.textContent)).toEqual(['Capital · Limited', 'Questions · Minting closed', 'Return funds only', 'Fork & recovery · Action'])
	expect(new Set(readReportIds)).toEqual(new Set([8n, 9n, 11n]))

	failFundingRead = true
	await act(() => invalidateAppData())
	await waitFor(() => expect(failedReads).toBeGreaterThan(0))
	expect(priceTab()?.textContent).toContain(returnFundsOnly)
	failFundingRead = false
	olderCredit = 1n
	await act(() => invalidateAppData())
	await waitFor(() => expect(priceTab()?.textContent).toContain(poolTabLabels.price))
	expect(priceTab()?.textContent).not.toContain(returnFundsOnly)
})

test('Capital links to REP price and does not mount its form', async () => {
	const source = capitalClient()
	source.install()
	const view = await renderSecurityPools()
	await waitFor(() => expect(view.container.querySelector('.statoblast-pool-state')?.textContent).toContain('Active'))
	expect(view.container.querySelector('a[href$="/price"]')?.textContent).toContain(poolTabLabels.price)
	expect(view.container.textContent).not.toContain(priceCopy.scopes.universe.request)
	expect(source.reads.some(read => read.name === 'isPriceReportingOpen')).toBe(false)
})

test('a direct Liquidations link to a forked pool explains why takeovers are unavailable', async () => {
	capitalClient(capitalSnapshot({ forkTime: 100n })).install()
	const view = await renderSecurityPools('liquidations')
	await waitFor(() => expect(view.container.textContent).toContain('Liquidations are unavailable in a universe that has forked.'))
	expect(view.container.querySelector('a[href$="/liquidations"]')).toBeNull()
})

test('the REP price tab preserves its draft through a failed pool refresh', async () => {
	const fixture = priceFixture(capitalSnapshot({ priceValid: false, priceValidUntil: 900n }))
	fixture.set(priceFeed, 'universeId', 0n)
	const view = await renderSecurityPools('price')
	const priceInput = () => [...view.container.querySelectorAll('input')].find(candidate => candidate.closest('.field')?.querySelector('label')?.textContent?.includes(priceCopy.priceDraftLabel('WETH')))
	await waitFor(() => expect(view.container.textContent).toContain('Wallet WETH'))
	await act(() => {
		const input = priceInput()
		if (input === undefined) throw new Error('Missing REP price input')
		input.value = '2'
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
	expect(priceInput()?.value).toBe('2')
	fixture.source.setRead('getForkTime', 'not a time')
	await act(() => invalidateAppData())
	await waitFor(() => expect(view.container.textContent).toContain('Unable to load this security pool position'))
	expect(priceInput()?.value).toBe('2')
	fixture.source.setRead('getForkTime', 0n)
	await act(() => invalidateAppData())
	await waitFor(() => expect(view.container.textContent).not.toContain('Unable to load this security pool position'))
	expect(priceInput()?.value).toBe('2')
})
