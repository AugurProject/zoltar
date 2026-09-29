import { afterEach, beforeEach } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createInjectedBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import type { InjectedEthereum } from '@zoltar/ui-core-shared/wallet/injectedEthereum.js'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import type { AnvilWindowEthereum } from '../../../../../../../solidity/ts/testSupport/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../../../../../../../solidity/ts/testSupport/simulator/useIsolatedAnvilNode'
import { addressString } from '../../../../../../../solidity/ts/testSupport/simulator/utils/bigint'
import { createWriteClient, type WriteClient } from '../../../../../../../solidity/ts/testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../../../../../../solidity/ts/testSupport/simulator/utils/constants'
import { ensureInfraDeployed } from '../../../../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast'
import { ensureZoltarDeployed } from '../../../../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { ensureProxyDeployerDeployed, setupTestAccounts } from '../../../../../../../solidity/ts/testSupport/simulator/utils/utilities'

function installInjectedEthereum(mockWindow: AnvilWindowEthereum, accountAddress: Address) {
	if (!Reflect.has(globalThis, 'window')) Reflect.set(globalThis, 'window', globalThis)
	const request: InjectedEthereum['request'] = async args => {
		if (args.method === 'eth_accounts' || args.method === 'eth_requestAccounts') return [accountAddress] as never
		return (await mockWindow.request(args)) as never
	}
	const injectedEthereum: InjectedEthereum = {
		on: mockWindow.on,
		removeListener: mockWindow.removeListener,
		request,
	}
	Reflect.set(globalThis.window, 'ethereum', injectedEthereum)
}

/**
 * Runs each test against an isolated Anvil node on the Sepolia chain ID with Zoltar and Statoblast infrastructure
 * deployed, and routes UI wallet clients through an injected wallet for the first test account.
 */
export function useSepoliaAnvilUiEnvironment() {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	const walletAddress = addressString(TEST_ADDRESSES[0])
	let current: { client: WriteClient; mockWindow: AnvilWindowEthereum } | undefined

	beforeEach(async () => {
		const mockWindow = getAnvilWindowEthereum()
		await mockWindow.request({ method: 'anvil_setChainId', params: [SEPOLIA_NETWORK_PROFILE.chain.id] })
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0, SEPOLIA_NETWORK_PROFILE.chain)
		installInjectedEthereum(mockWindow, walletAddress)
		// Preserve the seeded token addresses while exercising UI writes on Sepolia.
		installActiveEnvironmentForTesting(createInjectedBackend({ profile: { ...MAINNET_NETWORK_PROFILE, chain: SEPOLIA_NETWORK_PROFILE.chain, chainIdHex: SEPOLIA_NETWORK_PROFILE.chainIdHex, id: 'sepolia', displayName: 'Sepolia' } }))
		await setupTestAccounts(mockWindow)
		await ensureProxyDeployerDeployed(client)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		current = { client, mockWindow }
	})

	afterEach(() => {
		current = undefined
		resetActiveEnvironmentForTesting()
	})

	const requireCurrent = () => {
		if (current === undefined) throw new Error('The Anvil UI environment is only available inside a test')
		return current
	}

	return {
		getClient: () => requireCurrent().client,
		getMockWindow: () => requireCurrent().mockWindow,
		walletAddress,
	}
}
