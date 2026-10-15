import { encodeFunctionData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioDepositRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { advanceSimulationTime } from '@zoltar/ui-core-shared/simulation/clock.js'
import { createRangeProgressReporter, requireQaAccount } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact } from '../contractArtifact.js'
import { loadAllSecurityPools } from '../protocol/securityPools.js'
import { portfolioContractRequest, portfolioCreationRequest, portfolioReadClient, sendPortfolioTransaction } from '../protocol/securityPoolPortfolio.js'
import { settleSeededOracleReport, settleOracleReportIfNeeded, type ScenarioSeedParameters } from './statoblastScenarioSeeding.js'
import { prepareSeededPortfolioMint } from './portfolioScenarioMint.js'

/** Seeds real portfolio contracts on the browser-local chain, with no production RPC writes. */
export async function seedPortfolioScenario({ accounts, createReadClient, createWriteClient, memoryClient, onProgress, profile }: ScenarioSeedParameters) {
	const reportStep = createRangeProgressReporter(onProgress, { start: 0.98, end: 0.99 }, 14)
	await reportStep('Preparing shared portfolio')
	const owner = requireQaAccount(accounts[0], 'Expected portfolio simulation owner')
	const client = createWriteClient(owner)
	const readClient = createReadClient()
	const pools = (await loadAllSecurityPools(readClient)).filter(pool => pool.universeId === 0n && pool.parent === zeroAddress).slice(0, 2)
	const initial = pools[0]
	if (initial === undefined) throw new Error('Expected seeded origin pools')
	const deployment = await sendPortfolioTransaction(client, portfolioCreationRequest(owner, initial.securityPoolAddress, 366n * 86400n), 'Deploy portfolio')
	const portfolio = deployment.receipt.contractAddress
	if (portfolio === null || portfolio === undefined) throw new Error('Expected deployed portfolio address')
	await reportStep('Deployed shared portfolio')
	for (const [index, pool] of pools.entries()) {
		await sendPortfolioTransaction(client, portfolioContractRequest(owner, portfolio, 'addQuestion', [BigInt(pool.questionId)]), 'Register question')
		await reportStep(`Registered portfolio question ${index + 1} of ${pools.length}`)
	}
	await sendPortfolioTransaction(client, portfolioContractRequest(owner, portfolio, 'createVault'), 'Create owner vault')
	await reportStep('Created portfolio recovery vault')
	const depositAttoRep = 5000n * 10n ** 18n
	await sendPortfolioTransaction(client, { account: owner, to: profile.genesisRepTokenAddress, data: encodeFunctionData({ abi: ABIS.mainnet.erc20, functionName: 'approve', args: [portfolio, depositAttoRep] }), value: 0n }, 'Approve portfolio REP')
	await reportStep('Approved common portfolio REP deposit')
	await sendPortfolioTransaction(client, buildPortfolioDepositRequest({ owner, portfolio, amountAttoRep: depositAttoRep, minimumShares: depositAttoRep }), 'Deposit portfolio REP')
	await reportStep('Funded shared portfolio reserve')
	// One settlement refreshes every question in the portfolio universe.
	await advanceSimulationTime(memoryClient, 301n)
	const questionPool = await readClient.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'getPool', args: [BigInt(initial.questionId), 0n] })
	const managerAddress = (await loadAllSecurityPools(readClient)).find(pool => pool.securityPoolAddress.toLowerCase() === questionPool.toLowerCase())?.managerAddress
	if (managerAddress === undefined) throw new Error('Expected namespaced portfolio question pool')
	await reportStep('Preparing shared portfolio oracle')
	const report = await settleSeededOracleReport({ accountAddress: owner, createWriteClient, managerAddress, onProgressStep: reportStep, poolLabel: 'portfolio', readClient })
	await settleOracleReportIfNeeded({ memoryClient, readClient, writeClient: client, ...report })
	await reportStep('Settled shared portfolio oracle')
	for (const [index, pool] of pools.entries()) {
		const request = await prepareSeededPortfolioMint(portfolioReadClient(readClient), owner, portfolio, BigInt(pool.questionId))
		await sendPortfolioTransaction(client, request, 'Mint portfolio complete sets')
		await reportStep(`Minted shared portfolio question ${index + 1} of ${pools.length}`)
	}
	await reportStep('Shared portfolio scenario is ready')
}
