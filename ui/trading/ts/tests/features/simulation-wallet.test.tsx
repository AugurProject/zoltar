import type { WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { PublicClient } from '@zoltar/core-shared/evm/ethereum'
import { testDouble } from '@zoltar/ui-core-shared/tests/testUtils/testDouble.js'
import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { expect, test } from 'bun:test'
import { createPublicClient, createWalletClient, custom } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend, createFakeSimulationProfile } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { LiveTrading } from '../../features/LiveTrading.js'
import { liveTradingControllerServices } from '../../features/liveTradingControllerHelpers.js'
import type { WalletSummaryState } from '../../lib/walletSummaryState.js'

test('restores the shared simulation wallet without another connect click', async () => {
	const dom = installDomEnvironment()
	const account = '0x1111111111111111111111111111111111111111'
	let selectedAccount: `0x${string}` = account
	let accountsChanged: () => void = () => undefined
	const profile = createFakeSimulationProfile()
	const requests: string[] = []
	const provider = {
		request: async ({ method }: { method: string }) => {
			requests.push(method)
			return method === 'eth_chainId' ? profile.chainIdHex : [selectedAccount]
		},
	}
	const restore = installActiveEnvironmentForTesting({
		...createFakeBackend({ accountAddress: account, profile }),
		getProvider: () => provider,
		subscribeAccountsChanged: handler => {
			accountsChanged = handler
			return () => {
				accountsChanged = () => undefined
			}
		},
	})
	const client = createPublicClient({ transport: custom(provider) })
	const wallet = createWalletClient({ account, transport: custom(provider) })
	let summary: WalletSummaryState | undefined
	const page = { markets: [], universeIds: [0n], selectedUniverseId: 0n, start: 0n, count: 0n, total: 0n, previousStart: undefined, nextStart: undefined }
	const rendered = await renderIntoDocument(
		<LiveTrading
			route='portfolio'
			configuration={{
				zoltar: deploymentConfigurationFixture().zoltar,
				chainId: profile.chain.id,
				chainName: profile.displayName,
				factory: account,
				router: account,
				securityPoolFactory: account,
				feeBps: 30,
				rpcUrl: 'http://localhost/',
			}}
			configurationError={undefined}
			selectedUniverseId='0'
			onWorkflowLockChange={() => undefined}
			onWalletSummaryChange={value => {
				summary = value
			}}
			controllerServices={{
				...liveTradingControllerServices,
				createTradingPublicClient: () => testDouble<PublicClient>(client),
				createTradingWalletClient: () => testDouble<WriteClient>(wallet),
				validateLiveDeployment: async () => undefined,
				discoverLiveUniverseMarketPage: async () => page,
				discoverSavedMarkets: async () => page,
			}}
		/>,
	)
	try {
		await waitFor(() => expect(summary?.account).toBe(account))
		expect(rendered.container.textContent).not.toContain('Connect a wallet to load')
		expect(requests).not.toContain('eth_requestAccounts')
		selectedAccount = '0x2222222222222222222222222222222222222222'
		accountsChanged()
		await waitFor(() => expect(summary?.account).toBe(selectedAccount))
	} finally {
		await rendered.cleanup()
		restore()
		dom.cleanup()
	}
})
