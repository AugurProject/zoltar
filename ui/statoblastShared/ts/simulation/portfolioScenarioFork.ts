import { encodeFunctionData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { Zoltar_Zoltar as zoltarArtifact } from '@zoltar/ui-core-shared/contractArtifact.js'
import { advanceSimulationTime } from '@zoltar/ui-core-shared/simulation/clock.js'
import { mintSimulationGenesisRep, requireQaAccount, reportBootstrapProgress, type BootstrapScenarioApplyParameters } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact, statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact } from '../contractArtifact.js'
import { getInfraContractAddresses } from '../protocol/deploymentHelpers.js'
import { sendPortfolioTransaction } from '../protocol/securityPoolPortfolio.js'

/** Keep the wallet's parent shares and prepare their shared Yes-branch settlement. */
export async function forkSeededPortfolio(parameters: BootstrapScenarioApplyParameters, portfolio: Address, parentPool: Address, questionId: bigint) {
	const { memoryClient, profile, createWriteClient, createReadClient, onProgress } = parameters
	const owner = requireQaAccount(parameters.accounts[0], 'Expected portfolio fork simulation owner')
	const writer = createWriteClient(owner)
	const reader = createReadClient()
	const infrastructure = getInfraContractAddresses(profile)
	const zoltar = infrastructure.zoltar
	const threshold = await reader.readContract({ abi: zoltarArtifact.abi, address: zoltar, functionName: 'getForkThresholdAttoRep', args: [0n] })
	await mintSimulationGenesisRep({ accountAddress: owner, amount: threshold + 1_000n * 10n ** 18n, createWriteClient, memoryClient, repAddress: profile.genesisRepTokenAddress, zoltarAddress: zoltar })
	const balance = await reader.readContract({ abi: ABIS.mainnet.erc20, address: profile.genesisRepTokenAddress, functionName: 'balanceOf', args: [owner] })
	const send = (to: Address, data: `0x${string}`, title: string) => sendPortfolioTransaction(writer, { account: owner, to, data, value: 0n }, title)
	await send(profile.genesisRepTokenAddress, encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [zoltar, balance] }), 'Approve fork threshold REP')
	await advanceSimulationTime(memoryClient, 365n * 86_400n + 60n)
	await reportBootstrapProgress(onProgress, 'Forking the portfolio universe', 0.99)
	await send(zoltar, encodeFunctionData({ abi: zoltarArtifact.abi, functionName: 'forkUniverse', args: [0n, questionId] }), 'Fork portfolio universe')
	const controller = await reader.readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'forkController' })
	await send(controller, encodeFunctionData({ abi: forkArtifact.abi, functionName: 'prepareBranch', args: [0n, 1n] }), 'Prepare Yes branch')
	await send(controller, encodeFunctionData({ abi: forkArtifact.abi, functionName: 'choose', args: [0n, 1n] }), 'Choose Yes branch')
	await advanceSimulationTime(memoryClient, 63n * 86_400n)
	await reportBootstrapProgress(onProgress, 'Preparing shared branch settlement', 0.992)
	await send(controller, encodeFunctionData({ abi: forkArtifact.abi, functionName: 'startBranch', args: [0n, 1n] }), 'Start Yes branch')
	const child = await reader.readContract({ abi: zoltarArtifact.abi, address: zoltar, functionName: 'getChildUniverseId', args: [0n, 1n] })
	await send(controller, encodeFunctionData({ abi: forkArtifact.abi, functionName: 'finalizeBranch', args: [child] }), 'Activate Yes branch')
	await send(infrastructure.securityPoolForker, encodeFunctionData({ abi: forkerArtifact.abi, functionName: 'preparePortfolioQuestion', args: [parentPool, child] }), 'Prepare child question')
}
