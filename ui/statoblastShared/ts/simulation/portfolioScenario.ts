import { encodeFunctionData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioQuestionBatchRequest, buildPortfolioAutomaticUnderwritingRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { advanceSimulationTime } from '@zoltar/ui-core-shared/simulation/clock.js'
import { requireQaAccount } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact } from '../contractArtifact.js'
import { loadAllSecurityPools } from '../protocol/securityPools.js'
import { loadPortfolioOwnerVault, portfolioContractRequest, portfolioCreationRequest, sendPortfolioTransaction, vaultArtifact } from '../protocol/securityPoolPortfolio.js'
import { settleSeededOracleReport, settleOracleReportIfNeeded, type ScenarioSeedParameters } from './statoblastScenarioSeeding.js'

/** Seeds real portfolio contracts on the browser-local chain, with no production RPC writes. */
export async function seedPortfolioScenario({ accounts, createReadClient, createWriteClient, memoryClient, profile }: ScenarioSeedParameters) {
	const owner = requireQaAccount(accounts[0], 'Expected portfolio simulation owner')
	const client = createWriteClient(owner)
	const readClient = createReadClient()
	const pools = (await loadAllSecurityPools(readClient)).filter(pool => pool.universeId === 0n && pool.parent === zeroAddress).slice(0, 2)
	const initial = pools[0]
	if (initial === undefined) throw new Error('Expected seeded origin pools')
	const deployment = await sendPortfolioTransaction(client, portfolioCreationRequest(owner, initial.securityPoolAddress, 366n * 86400n), 'Deploy portfolio')
	const portfolio = deployment.receipt.contractAddress
	if (portfolio === null || portfolio === undefined) throw new Error('Expected deployed portfolio address')
	for (const pool of pools) await sendPortfolioTransaction(client, portfolioContractRequest(owner, portfolio, 'addQuestion', [BigInt(pool.questionId)]), 'Register question')
	await sendPortfolioTransaction(client, portfolioContractRequest(owner, portfolio, 'createVault'), 'Create owner vault')
	const { vault } = await loadPortfolioOwnerVault(readClient, portfolio, owner)
	await sendPortfolioTransaction(client, { account: owner, to: profile.genesisRepTokenAddress, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'transfer', args: [vault, 5000n * 10n ** 18n] }), value: 0n }, 'Fund portfolio vault')
	// One settlement refreshes every question in the portfolio universe.
	await advanceSimulationTime(memoryClient, 301n)
	const questionPool = await readClient.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'getPool', args: [BigInt(initial.questionId), 0n] })
	const managerAddress = (await loadAllSecurityPools(readClient)).find(pool => pool.securityPoolAddress.toLowerCase() === questionPool.toLowerCase())?.managerAddress
	if (managerAddress === undefined) throw new Error('Expected namespaced portfolio question pool')
	const report = await settleSeededOracleReport({ accountAddress: owner, createWriteClient, managerAddress, onProgressStep: async () => undefined, poolLabel: 'portfolio', readClient })
	await settleOracleReportIfNeeded({ memoryClient, readClient, writeClient: client, ...report })
	const operations = pools.map(pool => ({
		questionId: BigInt(pool.questionId),
		universeId: 0n,
		input: { depositAttoRep: 1000n * 10n ** 18n, changeCommitment: true, commitmentAttoEth: 1n * 10n ** 18n, liquidations: [], withdrawAttoRep: 0n, minimumReceiverHealthFactorBps: 12000n, validForSeconds: 300n },
		proposedRepPerEthPrice: 0n,
		requestedInitialAttoWeth: 0n,
		bountyAttoEth: 0n,
		value: 0n,
		minimumIdleAttoRep: 1000n * 10n ** 18n,
	}))
	await sendPortfolioTransaction(client, buildPortfolioQuestionBatchRequest({ owner, vault, vaultAbi: vaultArtifact.abi, operations, requireImmediate: true }), 'Allocate portfolio REP')
	const version = await readClient.readContract({ address: vault, abi: vaultArtifact.abi, functionName: 'allocationPolicyVersion' })
	const nonce = await readClient.readContract({ address: vault, abi: vaultArtifact.abi, functionName: 'allocationPolicyNonce' })
	await sendPortfolioTransaction(client, buildPortfolioAutomaticUnderwritingRequest({ owner, vault, expectedVersion: version, expectedNonce: nonce, minimumIdleAttoRep: 1000n * 10n ** 18n, minimumHealthFactorBps: 12000n, reservationFeeBps: 100n, minimumAllocationFeeAttoEth: 10n ** 15n }), 'Save underwriting settings')
}
