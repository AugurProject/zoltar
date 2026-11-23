import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { asWriteClient, createMockWriteClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { useSecurityPoolActions } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolActions.js'
import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiItem, parseAbiParameters, toEventSelector, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getInfraContractAddresses } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { auctionCapitalSnapshot, capitalSnapshot, owner, securityPool, token, capital } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'
import { getZoltarContractAddresses } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'
import { auctionFixture } from './auctionFixture.js'
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const parameters = { accountAddress: owner, onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }
function model(): Parameters<typeof useSecurityPoolActions>[0] {
	return {
		managerInput: securityPool,
		ownerInput: owner,
		universeInput: '0',
		snapshot: capitalSnapshot(),
		presentationSnapshot: undefined,
		setup: undefined,
		loading: false,
		discovering: false,
		error: undefined,
		setManagerInput: () => undefined,
		setOwnerInput: () => undefined,
		setUniverseInput: () => undefined,
		load: async () => undefined,
		refresh: async () => undefined,
		previousQuestionPage: async () => undefined,
		nextQuestionPage: async () => undefined,
		previousApprovedQuestionPage: async () => undefined,
		nextApprovedQuestionPage: async () => undefined,
	}
}
/** Renders the actions over `source` with an owner wallet that records each transaction, reports `token` as the first deployed contract and the factory's deployment event for `securityPool` after it. */
async function renderWithDeploymentWallet(source: ReturnType<typeof capitalClient>) {
	// The factory creates the security pool, so the receipt carries no contract address for it: only the factory's event names it.
	const topic = (value: Address) => encodeAbiParameters(parseAbiParameters('address'), [value])
	const deployed = () => ({ address: getInfraContractAddresses().securityPoolFactory, data: '0x' as const, topics: [toEventSelector(parseAbiItem('event SecurityPoolDeployed(address indexed securityPool, address indexed creator)')), topic(securityPool), topic(owner)] })
	const requests: { to?: Address | null | undefined; data?: Hex | undefined }[] = []
	const loaded: string[] = []
	const writer = asWriteClient({ ...createMockWriteClient(request => requests.push(request)), waitForTransactionReceipt: async () => (requests.length === 1 ? { status: 'success' as const, contractAddress: token, logs: [] } : { status: 'success' as const, contractAddress: undefined, logs: [deployed()] }) })
	installActiveEnvironmentForTesting({ ...source.backend, createWriteClient: () => ({ ...writer, account: { address: owner, type: 'json-rpc' }, chain: MAINNET_NETWORK_PROFILE.chain, call: async () => ({ data: undefined }) }) })
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, {
		model: {
			...model(),
			load: async address => {
				loaded.push(address ?? '')
			},
		},
	})
	lifecycle.trackRendered(hook)
	return { hook, requests, loaded }
}
test('creation uses an explicit admission transaction before deployment and invalidates changed policies', async () => {
	const source = capitalClient()
	const { hook, requests, loaded } = await renderWithDeploymentWallet(source)
	await act(() => hook.state().setOriginInput(securityPool))
	expect(hook.state().deployReason).toContain('admission policy first')
	await act(() => hook.state().deployAdmission())
	expect(hook.state().error).toBeUndefined()
	expect(requests).toHaveLength(1)
	expect(hook.state().admissionAddress).toBe(token)
	expect(hook.state().deployReason).toBeUndefined()
	await act(() => hook.state().deploy())
	expect(hook.state().error).toBeUndefined()
	expect(requests).toHaveLength(2)
	expect(requests[1]?.to).toBe(getInfraContractAddresses().securityPoolFactory)
	expect(loaded).toEqual([securityPool])
	await act(() => {
		hook.state().setAdmissionMode('fixed')
		hook.state().setFixedQuestions('5,7')
	})
	expect(hook.state().admissionAddress).toBeUndefined()
	expect(hook.state().deployReason).toContain('admission policy first')
})
function useSecurityPoolActionsWrapper(props: { model: ReturnType<typeof model>; parameters?: Parameters<typeof useSecurityPoolActions>[1] }) {
	return useSecurityPoolActions(props.model, props.parameters ?? parameters)
}
test('a winning vault is controlled by its bidder before and after automatic materialization', async () => {
	capitalClient().install()
	const snapshot = auctionCapitalSnapshot()
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: { ...model(), snapshot } })
	lifecycle.trackRendered(hook)
	expect(hook.state().ownerReason).toBeUndefined()
	await hook.setProps({ parameters: { ...parameters, accountAddress: token } })
	expect(hook.state().ownerReason).toContain('owner')
	const auctionVault = snapshot.auctionVault
	if (auctionVault === undefined) throw new Error('Missing auction authority')
	await hook.setProps({ parameters, model: { ...model(), snapshot: { ...snapshot, auctionVault: { ...auctionVault, materialized: false } } } })
	expect(hook.state().ownerReason).toBeUndefined()
})
test('individual capital actions execute through the authenticated auction vault and sweep returned assets to its bidder', async () => {
	const fixture = await auctionFixture()
	const snapshot = auctionCapitalSnapshot()
	const requests: { data?: Hex | undefined; to?: string | null | undefined }[] = []
	const writer = asWriteClient(createMockWriteClient(request => requests.push(request)))
	installActiveEnvironmentForTesting({ ...fixture.backend, createWriteClient: () => ({ ...writer, account: { address: owner, type: 'json-rpc' }, chain: MAINNET_NETWORK_PROFILE.chain, call: async () => ({ data: undefined }) }) })
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: { ...model(), snapshot } })
	lifecycle.trackRendered(hook)
	const abi = parseAbi(['function claimEarnings()', 'function executeAndSweep(address target,uint256 value,bytes data,address token,address recipient) payable returns(bytes)'])
	const data = encodeFunctionData({ abi, functionName: 'claimEarnings' })
	await act(() => hook.state().runSecurityPoolAction('claimSecurityPoolEarnings', 'Claim earnings', () => ({ account: snapshot.owner, to: capital, value: 0n, data })))
	expect(hook.state().error).toBeUndefined()
	expect(requests).toHaveLength(1)
	const request = requests[0]
	if (request?.data === undefined) throw new Error('Missing vault execution')
	expect(request.to).toBe(snapshot.owner)
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'executeAndSweep', args: [capital, 0n, data, token, owner] })
	fixture.values['owner'] = token
	await act(() => hook.state().runSecurityPoolAction('claimSecurityPoolEarnings', 'Claim earnings', () => ({ account: snapshot.owner, to: capital, value: 0n, data })))
	expect(hook.state().error).toBeDefined()
	expect(requests).toHaveLength(1)
})
test('an authenticated security pool refresh keeps actions disabled with a loading reason', async () => {
	capitalClient().install()
	const base = model()
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: base })
	lifecycle.trackRendered(hook)
	await hook.setProps({ model: { ...base, snapshot: undefined, loading: true } })
	expect(hook.state().ownerReason).toBe('Loading security pool…')
	expect(hook.state().registerReason).toBe('Loading security pool…')
	await hook.setProps({ model: base })
	expect(hook.state().ownerReason).toBeUndefined()
})
test('a pending action keeps its refresh gap loading until the transaction finishes', async () => {
	const source = capitalClient()
	const requests: { data?: Hex | undefined }[] = []
	const writer = asWriteClient(createMockWriteClient(request => requests.push(request)))
	installActiveEnvironmentForTesting({ ...source.backend, createWriteClient: () => ({ ...writer, account: { address: owner, type: 'json-rpc' }, chain: MAINNET_NETWORK_PROFILE.chain, call: async () => ({ data: undefined }) }) })
	const refresh = createDeferred<void>()
	let refreshing = false
	const base = {
		...model(),
		refresh: async () => {
			refreshing = true
			await refresh.promise
		},
	}
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: base })
	lifecycle.trackRendered(hook)
	const ownerReason = hook.state().ownerReason
	let pending: Promise<void> | undefined
	try {
		await act(() => {
			pending = hook.state().runSecurityPoolAction('depositSecurityPoolHealthRep', 'Deposit REP and save target', () => {
				if (ownerReason !== undefined) throw new Error(ownerReason)
				return { account: owner, to: securityPool, data: '0x' }
			})
		})
		await waitFor(() => expect(refreshing).toBe(true))
		await hook.setProps({ model: { ...base, snapshot: undefined, loading: false } })
		expect(hook.state().busy).toBe('depositSecurityPoolHealthRep')
		expect(hook.state().ownerReason).toBe('Loading security pool…')
		expect(requests).toHaveLength(1)
	} finally {
		await act(async () => {
			refresh.resolve()
			await pending
		})
	}
	expect(hook.state().busy).toBeUndefined()
	expect(hook.state().error).toBeUndefined()
	expect(hook.state().feedback).toBe('Transaction confirmed')
	expect(hook.state().ownerReason).toBe('Open a security pool first')
	await hook.setProps({ model: base })
	expect(hook.state().ownerReason).toBeUndefined()
})
test('owner availability preserves the empty state and prioritizes the wallet guard', async () => {
	capitalClient().install()
	const empty = { ...model(), snapshot: undefined }
	const props: Parameters<typeof useSecurityPoolActionsWrapper>[0] = { model: empty }
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, props)
	lifecycle.trackRendered(hook)
	expect(hook.state().ownerReason).toBe('Open a security pool first')
	await hook.setProps({ parameters: { ...parameters, accountAddress: undefined } })
	expect(hook.state().ownerReason).toBe('Connect a wallet before sending transactions.')
	await hook.setProps({ model: { ...empty, loading: true } })
	expect(hook.state().ownerReason).toBe('Connect a wallet before sending transactions.')
})
test('creation rejects invalid economics without changing the owner health target', async () => {
	capitalClient().install()
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model() })
	lifecycle.trackRendered(hook)
	await act(() => {
		hook.state().setOriginInput(securityPool)
		hook.state().setEconomicsField('minimumCommitment', '0')
	})
	expect(hook.state().creationError).toContain('positive')
	expect(hook.state().economicsDraft).not.toHaveProperty('targetHealthPercent')
	expect(hook.state().economicsDraft).not.toHaveProperty('auctionReservePercent')
	await act(() => hook.state().setEconomicsField('minimumCommitment', '1'))
	expect(hook.state().creationError).toBeUndefined()
})

test('setup advances one explicit stage and rejects a stale stage before wallet submission', async () => {
	const source = capitalClient()
	source.setSetupStage(1n)
	const requests: { data?: Hex | undefined }[] = []
	const writer = asWriteClient(createMockWriteClient(request => requests.push(request)))
	installActiveEnvironmentForTesting({ ...source.backend, createWriteClient: () => ({ ...writer, account: { address: owner, type: 'json-rpc' }, chain: MAINNET_NETWORK_PROFILE.chain, call: async () => ({ data: undefined }) }) })
	const base = model()
	const snapshot = capitalSnapshot()
	const setup = { securityPool, owner, stage: 1, originUniverseId: 0n, originForkTime: 0n, chainId: 1, blockNumber: snapshot.blockNumber, blockHash: snapshot.blockHash }
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: { ...base, snapshot: undefined, setup } })
	lifecycle.trackRendered(hook)
	expect(hook.state().preparationReason(1)).toContain('complete')
	expect(hook.state().preparationReason(3)).toContain('previous')
	await act(() => hook.state().prepare(2))
	expect(hook.state().error).toBeUndefined()
	expect(requests).toHaveLength(1)
	const data = requests[0]?.data
	if (data === undefined) throw new Error('Missing setup transaction')
	expect(decodeFunctionData({ abi: parseAbi(['function prepareNext()']), data }).functionName).toBe('prepareNext')
	source.setSetupStage(2n)
	await act(() => hook.state().prepare(2))
	expect(hook.state().error).toContain('Setup advanced')
	expect(requests).toHaveLength(1)
	source.setSetupStage(1n)
	source.setRead('getForkTime', 900n)
	await act(() => hook.state().prepare(2))
	expect(hook.state().error).toContain('Origin universe forked')
	expect(requests).toHaveLength(1)
	await hook.setProps({ model: { ...base, snapshot: undefined, setup: { ...setup, originForkTime: 900n } } })
	expect(hook.state().preparationReason(2)).toContain('Origin universe forked')
})

test('presentation-only accounts explain refresh without enabling writes or replacing the wallet guard', async () => {
	capitalClient().install()
	const base = { ...model(), snapshot: undefined, presentationSnapshot: capitalSnapshot() }
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: base, parameters })
	lifecycle.trackRendered(hook)
	expect(hook.state().ownerReason).toBe('Account refresh pending.')
	await hook.setProps({ parameters: { ...parameters, accountAddress: undefined } })
	expect(hook.state().ownerReason).toBe('Connect a wallet before sending transactions.')
})

test('security pool creation rejects priority fees above the oracle funding bound before any transaction', async () => {
	capitalClient().install()
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model() })
	lifecycle.trackRendered(hook)
	await act(() => hook.state().setPriorityFeeInput(formatUnits(MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS + 1n, 9)))
	expect(hook.state().creationError).toContain('Oracle priority fee exceeds the report funding limit.')
	await act(() => hook.state().setPriorityFeeInput(formatUnits(MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, 9)))
	expect(hook.state().creationError).toBeUndefined()
})

test('USDC creation validates the configured oracle floor in six-decimal collateral units', async () => {
	capitalClient().install()
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model() })
	lifecycle.trackRendered(hook)
	await act(() => {
		hook.state().setCollateralSymbol('USDC')
		hook.state().setReportFloor('0.0000001')
	})
	expect(hook.state().deployReason).toContain('up to 6 decimal places')
	await act(() => {
		hook.state().setReportFloor('0.000001')
		hook.state().setEconomicsField('minimumCommitment', '100')
		hook.state().setEconomicsField('minimumPurchaseFee', '1')
	})
	expect(hook.state().deployReason).toContain('admission policy first')
	await act(() => hook.state().setReportFloor('0'))
	expect(hook.state().deployReason).toContain('positive report stake floor')
})
test('the origin universe follows the selected universe until the user edits it', async () => {
	capitalClient().install()
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: { ...model(), universeInput: '7' } })
	lifecycle.trackRendered(hook)
	expect(hook.state().originInput).toBe('7')
	await hook.setProps({ model: { ...model(), universeInput: '9' } })
	expect(hook.state().originInput).toBe('9')
	await act(() => hook.state().setOriginInput('3'))
	await hook.setProps({ model: { ...model(), universeInput: '11' } })
	expect(hook.state().originInput).toBe('3')
})

test('a forked origin stops creation before the paid admission deployment', async () => {
	const source = capitalClient()
	source.setRead('getForkTime', 1n)
	const { hook, requests } = await renderWithDeploymentWallet(source)
	await waitFor(() => expect(hook.state().originForked).toBe(true))
	expect(hook.state().creationError).toBeUndefined()
	expect(hook.state().admissionDeployReason).toContain('has forked')
	expect(hook.state().deployReason).toContain('has forked')
	await act(() => hook.state().deployAdmission())
	expect(requests).toHaveLength(0)
	expect(hook.state().error).toContain('has forked')
})

test('a universe that forks after the form checked it still stops at submission', async () => {
	const source = capitalClient()
	const { hook, requests } = await renderWithDeploymentWallet(source)
	await waitFor(() => expect(hook.state().admissionDeployReason).toBeUndefined())
	source.setRead('getForkTime', 1n)
	await act(() => hook.state().deployAdmission())
	expect(requests).toHaveLength(0)
	expect(hook.state().error).toContain('has forked')
	expect(hook.state().originForked).toBe(true)
	expect(hook.state().admissionDeployReason).toContain('has forked')
	expect(hook.state().deployReason).toContain('has forked')
})

test('a fork seen on one network does not block the same universe ID on another', async () => {
	const forkedNetwork = capitalClient()
	forkedNetwork.setRead('getForkTime', 1n)
	forkedNetwork.install()
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model() })
	lifecycle.trackRendered(hook)
	await waitFor(() => expect(hook.state().originForked).toBe(true))
	const unforkedNetwork = capitalClient()
	unforkedNetwork.setRead('getForkTime', 0n)
	unforkedNetwork.install()
	await hook.setProps({ model: model() })
	await waitFor(() => expect(hook.state().originForked).toBe(false))
	expect(hook.state().admissionDeployReason).toBeUndefined()
})

test('a fork between the two paid deployments stops the security pool deployment', async () => {
	const source = capitalClient()
	const { hook, requests } = await renderWithDeploymentWallet(source)
	await act(() => hook.state().deployAdmission())
	expect(requests).toHaveLength(1)
	source.setRead('getForkTime', 1n)
	await act(() => hook.state().deploy())
	expect(requests).toHaveLength(1)
	expect(hook.state().error).toContain('has forked')
	expect(hook.state().deployReason).toContain('has forked')
})

test('changing collateral requires deliberate token-denominated economic amounts', async () => {
	capitalClient().install()
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model() })
	lifecycle.trackRendered(hook)
	await act(() => hook.state().setCollateralSymbol('USDC'))
	expect(hook.state().reportFloor).toBe('')
	expect(hook.state().economicsDraft.minimumCommitment).toBe('')
	expect(hook.state().economicsDraft.minimumPurchaseFee).toBe('')
	expect(hook.state().creationError).toBeDefined()
})

test('question registration is blocked outside the security pool horizon by chain time', async () => {
	const day = 86_400n
	const { timestamp: now, blockNumber } = capitalSnapshot()
	const { zoltarQuestionData } = getZoltarContractAddresses()
	const source = capitalClient()
	source.setRead('isQuestionAllowed', true)
	source.setRead('maximumQuestionHorizonSeconds', 30n * day)
	const { hook, requests } = await renderWithDeploymentWallet(source)
	const horizonReads = () => source.reads.filter(read => read.name === 'maximumQuestionHorizonSeconds' || read.name === 'getQuestionEndDate')
	const expectReason = async (questionId: string, endTime: bigint, reason: string | undefined) => {
		// Scoped to the question data contract, so an end-date read anywhere else fails as an unexpected read.
		source.setRead('getQuestionEndDate', endTime, zoltarQuestionData)
		await act(() => hook.state().setQuestionInput(questionId))
		if (reason === undefined) await waitFor(() => expect(hook.state().registerReason).toBeUndefined())
		else await waitFor(() => expect(hook.state().registerReason).toContain(reason))
	}
	await expectReason('7', now + day, undefined)
	await expectReason('8', now, 'has ended')
	await expectReason('9', 0n, 'does not exist')
	await expectReason('10', now + 30n * day + 1n, '30-day question horizon')
	const end = now + 30n * day
	await expectReason('11', end, undefined)
	const displayedReads = horizonReads()
	expect(displayedReads.filter(read => read.name === 'getQuestionEndDate').map(read => read.address)).toEqual(Array.from({ length: 5 }, () => zoltarQuestionData))
	expect(displayedReads.filter(read => read.name === 'maximumQuestionHorizonSeconds').map(read => read.address)).toEqual(Array.from({ length: 5 }, () => securityPool))
	expect(new Set(displayedReads.map(read => read.blockNumber))).toEqual(new Set([blockNumber]))
	// Chain time can reach the end between the displayed check and submission; the transaction lands at least one second after the latest block.
	source.setSnapshot(capitalSnapshot({ timestamp: end - 1n, blockNumber: blockNumber + 1n }))
	await act(() => hook.state().register())
	expect(requests).toHaveLength(0)
	expect(hook.state().error).toContain('has ended')
	const submitReads = horizonReads().slice(displayedReads.length)
	expect(new Set(submitReads.map(read => read.blockNumber))).toEqual(new Set([blockNumber + 1n]))
})

test('registration rejects non-binary questions and insufficient escalation thresholds before signing', async () => {
	const now = capitalSnapshot().timestamp
	const source = capitalClient()
	source.setRead('isQuestionAllowed', true)
	source.setRead('maximumQuestionHorizonSeconds', 86_400n)
	source.setRead('getQuestionEndDate', now + 100n)
	source.setRead('getOutcomeLabels', ['Yes', 'No', 'Other'])
	source.setRead('getNonDecisionThresholdAttoRep', 2n * 10n ** 18n)
	source.setRead('getUniverseTheoreticalSupplyAttoRep', 1_000_000n * 10n ** 18n)
	const { hook, requests } = await renderWithDeploymentWallet(source)
	await act(() => {
		hook.state().setQuestionInput('7')
	})
	await waitFor(() => expect(hook.state().registerReason).toContain('Yes/No binary'))
	source.setRead('getOutcomeLabels', ['Yes', 'No'])
	source.setRead('getNonDecisionThresholdAttoRep', 10n ** 18n)
	await act(() => {
		hook.state().setQuestionInput('8')
	})
	await waitFor(() => expect(hook.state().registerReason).toContain('threshold is too low'))
	source.setRead('getNonDecisionThresholdAttoRep', 2n * 10n ** 18n)
	await act(() => {
		hook.state().setQuestionInput('9')
	})
	await waitFor(() => expect(hook.state().registerReason).toBeUndefined())
	await act(async () => {
		await hook.state().register()
	})
	expect(requests).toHaveLength(1)
	source.setRead('getOutcomeLabels', ['No', 'Yes'])
	await act(async () => {
		await hook.state().register()
	})
	expect(requests).toHaveLength(1)
	expect(hook.state().error).toContain('Yes/No binary')
})
