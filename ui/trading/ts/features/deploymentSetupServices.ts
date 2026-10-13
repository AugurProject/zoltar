import { createPublicClient, http, type Hash, type PublicClient } from '@zoltar/core-shared/evm/ethereum'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { ChainBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'

import { loadCoreDeployments } from '../protocol/coreDeployments.js'
import { deployTradingStep, type CoreDeployment, type TradingDeploymentPlan, type TradingDeploymentStep } from '../protocol/deployment.js'
import { getActiveInjectedProvider, type InjectedEthereum } from '../protocol/injected.js'
import { readInjectedChainIdNumber, requestInjectedAccount, switchInjectedChain } from '@zoltar/ui-core-shared/wallet/injectedEthereum.js'
import { createTradingWalletClient, validateRpcChainId } from '../protocol/live.js'

import * as deploymentCopy from '../copy/deployment.js'

export type TradingDeploymentSetupServices = Readonly<{
	createPublicClient(rpcUrl: string): PublicClient
	connectWallet?(): Promise<{ account: string; chainId: number; provider?: InjectedEthereum }>
	deployStep?(publicClient: PublicClient, plan: TradingDeploymentPlan, step: TradingDeploymentStep, onSubmitted: (hash: Hash) => void): Promise<void>
	getWalletProvider?(): InjectedEthereum | undefined
	loadCoreDeployments(): Promise<readonly CoreDeployment[]>
}>

function createDeploymentReadClient(rpcUrl: string, backend: Pick<ChainBackend, 'createReadClient' | 'id'> = getActiveBackend()): PublicClient {
	return backend.id === 'simulation' ? backend.createReadClient() : createPublicClient({ transport: http(rpcUrl) })
}

export const defaultTradingDeploymentSetupServices: TradingDeploymentSetupServices = {
	createPublicClient: createDeploymentReadClient,
	connectWallet: async () => {
		const provider = getActiveInjectedProvider()
		if (provider === undefined) throw new Error(deploymentCopy.walletNotFound)
		const account = await requestInjectedAccount(provider)
		return { account, chainId: await readInjectedChainIdNumber(provider), provider }
	},
	getWalletProvider: getActiveInjectedProvider,
	deployStep: async (publicClient, plan, step, onSubmitted) => {
		const provider = getActiveInjectedProvider()
		if (provider === undefined) throw new Error(deploymentCopy.walletNotFound)
		let currentChainId = await readInjectedChainIdNumber(provider)
		if (currentChainId !== plan.core.chainId) {
			await switchInjectedChain(provider, plan.core.chainId)
			currentChainId = await readInjectedChainIdNumber(provider)
		}
		if (currentChainId !== plan.core.chainId) throw new Error(deploymentCopy.walletMustUseNetwork(plan.core.chainName))
		const account = await requestInjectedAccount(provider)
		const walletClient = createTradingWalletClient(provider, account)
		await deployTradingStep(walletClient, publicClient, plan, step, onSubmitted, async () => {
			validateRpcChainId(await publicClient.getChainId(), plan.core.chainId)
			if (getActiveInjectedProvider() !== provider || (await readInjectedChainIdNumber(provider)) !== plan.core.chainId || (await requestInjectedAccount(provider)) !== account) throw new Error(deploymentCopy.walletChangedBeforeDeployment)
		})
		if (getActiveInjectedProvider() !== provider || (await readInjectedChainIdNumber(provider)) !== plan.core.chainId || (await requestInjectedAccount(provider)) !== account) throw new Error(deploymentCopy.walletChangedDuringDeployment)
	},
	loadCoreDeployments,
}
