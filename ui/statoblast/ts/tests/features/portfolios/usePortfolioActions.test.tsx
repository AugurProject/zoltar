import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { asWriteClient, createMockWriteClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { usePortfolioActions } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioActions.js'
import { decodeFunctionData, encodeFunctionData, parseAbi, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { renderHookWithProps } from '../../support/renderHook.js'
import { auctionCapitalSnapshot, capitalSnapshot, owner, portfolio, token, capital } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'
import { auctionFixture } from './auctionFixture.js'
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const parameters = { accountAddress: owner, onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }
function model(): Parameters<typeof usePortfolioActions>[0] {
	return {
		managerInput: portfolio,
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
test('creation uses an explicit admission transaction before deployment and invalidates changed policies', async () => {
	const source = capitalClient()
	const requests: { data?: Hex | undefined }[] = []
	const writer = asWriteClient({ ...createMockWriteClient(request => requests.push(request)), waitForTransactionReceipt: async () => ({ status: 'success' as const, contractAddress: token }) })
	installActiveEnvironmentForTesting({ ...source.backend, createWriteClient: () => ({ ...writer, account: { address: owner, type: 'json-rpc' }, chain: MAINNET_NETWORK_PROFILE.chain, call: async () => ({ data: undefined }) }) })
	const hook = await renderHookWithProps(usePortfolioActionsWrapper, { model: model() })
	lifecycle.trackRendered(hook)
	await act(() => hook.state().setOriginInput(portfolio))
	expect(hook.state().deployReason).toContain('admission policy first')
	await act(() => hook.state().deployAdmission())
	expect(hook.state().error).toBeUndefined()
	expect(requests).toHaveLength(1)
	expect(hook.state().admissionAddress).toBe(token)
	expect(hook.state().deployReason).toBeUndefined()
	await act(() => hook.state().deploy())
	expect(hook.state().error).toBeUndefined()
	expect(requests).toHaveLength(2)
	await act(() => {
		hook.state().setAdmissionMode('fixed')
		hook.state().setFixedQuestions('5,7')
	})
	expect(hook.state().admissionAddress).toBeUndefined()
	expect(hook.state().deployReason).toContain('admission policy first')
})
function usePortfolioActionsWrapper(props: { model: ReturnType<typeof model>; parameters?: Parameters<typeof usePortfolioActions>[1] }) {
	return usePortfolioActions(props.model, props.parameters ?? parameters)
}
test('a winning vault is controlled by its bidder and individual controls wait for materialization', async () => {
	capitalClient().install()
	const snapshot = auctionCapitalSnapshot()
	const hook = await renderHookWithProps(usePortfolioActionsWrapper, { model: { ...model(), snapshot } })
	lifecycle.trackRendered(hook)
	expect(hook.state().ownerReason).toBeUndefined()
	await hook.setProps({ parameters: { ...parameters, accountAddress: token } })
	expect(hook.state().ownerReason).toContain('owner')
	const auctionVault = snapshot.auctionVault
	if (auctionVault === undefined) throw new Error('Missing auction authority')
	await hook.setProps({ parameters, model: { ...model(), snapshot: { ...snapshot, auctionVault: { ...auctionVault, materialized: false } } } })
	expect(hook.state().ownerReason).toContain('Activate this individual vault')
})
test('individual capital actions execute through the authenticated auction vault and sweep returned assets to its bidder', async () => {
	const fixture = await auctionFixture()
	const snapshot = auctionCapitalSnapshot()
	const requests: { data?: Hex | undefined; to?: string | undefined }[] = []
	const writer = asWriteClient(createMockWriteClient(request => requests.push(request)))
	installActiveEnvironmentForTesting({ ...fixture.backend, createWriteClient: () => ({ ...writer, account: { address: owner, type: 'json-rpc' }, chain: MAINNET_NETWORK_PROFILE.chain, call: async () => ({ data: undefined }) }) })
	const hook = await renderHookWithProps(usePortfolioActionsWrapper, { model: { ...model(), snapshot } })
	lifecycle.trackRendered(hook)
	const abi = parseAbi(['function claimEarnings()', 'function executeAndSweep(address target,uint256 value,bytes data,address token,address recipient) payable returns(bytes)'])
	const data = encodeFunctionData({ abi, functionName: 'claimEarnings' })
	await act(() => hook.state().runPortfolioAction('claimPortfolioEarnings', 'Claim earnings', () => ({ account: snapshot.owner, to: capital, value: 0n, data })))
	expect(hook.state().error).toBeUndefined()
	expect(requests).toHaveLength(1)
	const request = requests[0]
	if (request?.data === undefined) throw new Error('Missing vault execution')
	expect(request.to).toBe(snapshot.owner)
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'executeAndSweep', args: [capital, 0n, data, token, owner] })
	fixture.values['owner'] = token
	await act(() => hook.state().runPortfolioAction('claimPortfolioEarnings', 'Claim earnings', () => ({ account: snapshot.owner, to: capital, value: 0n, data })))
	expect(hook.state().error).toBeDefined()
	expect(requests).toHaveLength(1)
})
test('an authenticated portfolio refresh keeps actions disabled with a loading reason', async () => {
	capitalClient().install()
	const base = model()
	const hook = await renderHookWithProps(usePortfolioActionsWrapper, { model: base })
	lifecycle.trackRendered(hook)
	await hook.setProps({ model: { ...base, snapshot: undefined, loading: true } })
	expect(hook.state().ownerReason).toBe('Loading portfolio…')
	expect(hook.state().registerReason).toBe('Loading portfolio…')
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
	const hook = await renderHookWithProps(usePortfolioActionsWrapper, { model: base })
	lifecycle.trackRendered(hook)
	const ownerReason = hook.state().ownerReason
	let pending: Promise<void> | undefined
	try {
		await act(() => {
			pending = hook.state().runPortfolioAction('depositPortfolioHealthRep', 'Deposit REP and save target', () => {
				if (ownerReason !== undefined) throw new Error(ownerReason)
				return { account: owner, to: portfolio, data: '0x' }
			})
		})
		await waitFor(() => expect(refreshing).toBe(true))
		await hook.setProps({ model: { ...base, snapshot: undefined, loading: false } })
		expect(hook.state().busy).toBe('depositPortfolioHealthRep')
		expect(hook.state().ownerReason).toBe('Loading portfolio…')
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
	expect(hook.state().ownerReason).toBe('Open a portfolio first')
	await hook.setProps({ model: base })
	expect(hook.state().ownerReason).toBeUndefined()
})
test('owner availability preserves the empty state and prioritizes the wallet guard', async () => {
	capitalClient().install()
	const empty = { ...model(), snapshot: undefined }
	const props: Parameters<typeof usePortfolioActionsWrapper>[0] = { model: empty }
	const hook = await renderHookWithProps(usePortfolioActionsWrapper, props)
	lifecycle.trackRendered(hook)
	expect(hook.state().ownerReason).toBe('Open a portfolio first')
	await hook.setProps({ parameters: { ...parameters, accountAddress: undefined } })
	expect(hook.state().ownerReason).toBe('Connect a wallet to send transactions')
	await hook.setProps({ model: { ...empty, loading: true } })
	expect(hook.state().ownerReason).toBe('Connect a wallet to send transactions')
})
test('creation rejects invalid economics without changing the owner health target', async () => {
	capitalClient().install()
	const hook = await renderHookWithProps(usePortfolioActionsWrapper, { model: model() })
	lifecycle.trackRendered(hook)
	await act(() => {
		hook.state().setOriginInput(portfolio)
		hook.state().setEconomicsField('minimumCommitment', '0')
	})
	expect(hook.state().creationError).toContain('positive')
	expect(hook.state().economicsDraft).not.toHaveProperty('targetHealthPercent')
	expect(hook.state().economicsDraft.auctionReservePercent).toBe('50')
	await act(() => hook.state().setEconomicsField('minimumCommitment', '1'))
	expect(hook.state().creationError).toBeUndefined()
	await act(() => hook.state().setEconomicsField('auctionReservePercent', '0'))
	expect(hook.state().creationError).toContain('Auction reserve')
	await act(() => hook.state().setEconomicsField('auctionReservePercent', '50'))
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
	const setup = { portfolio, owner, stage: 1, originUniverseId: 0n, chainId: 1, blockNumber: snapshot.blockNumber, blockHash: snapshot.blockHash }
	const hook = await renderHookWithProps(usePortfolioActionsWrapper, { model: { ...base, snapshot: undefined, setup } })
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
})

test('presentation-only accounts explain refresh without enabling writes or replacing the wallet guard', async () => {
	capitalClient().install()
	const base = { ...model(), snapshot: undefined, presentationSnapshot: capitalSnapshot() }
	const hook = await renderHookWithProps(usePortfolioActionsWrapper, { model: base, parameters })
	lifecycle.trackRendered(hook)
	expect(hook.state().ownerReason).toBe('Account refresh pending.')
	await hook.setProps({ parameters: { ...parameters, accountAddress: undefined } })
	expect(hook.state().ownerReason).toBe('Connect a wallet to send transactions')
})
