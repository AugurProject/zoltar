import { encodeDeployData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioDeploymentRequest, buildPortfolioPrepareNextRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolOpenAdmissionPolicy_SecurityPoolOpenAdmissionPolicy as policyArtifact } from '../../../../types/contractArtifact'
import { deployContract } from '../../../deployContract'
import { type WriteClient, writeContractAndWait } from '../clients'
import { applyLibraries, getInfraContractAddresses, getSecurityPoolAddresses } from './deployStatoblast'

/** A fully prepared native portfolio with one registered question and no owner capital. */
export async function deployTestPortfolio(client: WriteClient, universeId: bigint, questionId: bigint, securityMultiplierBps: bigint) {
	const infrastructure = getInfraContractAddresses()
	const questionAdmissionPolicy = await deployContract(client, encodeDeployData({ abi: policyArtifact.abi, bytecode: applyLibraries(policyArtifact.evm.bytecode.object) }))
	const reportPriorityFeeAttoEthPerGas = DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS
	const request = buildPortfolioDeploymentRequest({
		owner: client.account.address,
		factory: infrastructure.securityPoolFactory,
		origin: { collateralToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', minimumReportCollateral: 10n ** 16n, universeId, securityMultiplierBps, reportPriorityFeeAttoEthPerGas },
		maximumQuestionHorizonSeconds: 20n * 365n * 86_400n,
		questionAdmissionPolicy,
		economics: { purchaseFeeBps: 100n, annualFeeBps: 1_000n, minimumPurchaseFeeAttoEth: 10n ** 15n, minimumCommitmentAttoEth: 10n ** 16n, minimumOutcomeRate: 1_000n, rewardVestingSeconds: 86_400n },
		deployers: {
			capital: infrastructure.securityPoolCapitalLedgerDeployer,
			commitments: infrastructure.securityPoolCommitmentIndexDeployer,
			fees: infrastructure.securityPoolCapitalFeeStreamsDeployer,
			books: infrastructure.securityPoolSettlementBookDeployer,
			settlement: infrastructure.securityPoolPortfolioSettlementDeployer,
			reporters: infrastructure.securityPoolReporterLedgerDeployer,
			forks: infrastructure.securityPoolPortfolioForkCoordinatorDeployer,
			auctions: infrastructure.securityPoolPortfolioAuctionDeployer,
			services: infrastructure.securityPoolPortfolioServicesDeployer,
		},
		artifact: { abi: portfolioArtifact.abi, bytecode: applyLibraries(portfolioArtifact.evm.bytecode.object) },
	})
	const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ ...request, gas: 16_777_216n }) })
	if (receipt.status !== 'success' || receipt.contractAddress === undefined) throw new Error('Test portfolio deployment failed')
	const portfolio = receipt.contractAddress
	for (let stage = 0; stage < 4; stage++) await writeContractAndWait(client, () => client.sendTransaction({ ...buildPortfolioPrepareNextRequest({ caller: client.account.address, portfolio }), gas: 16_777_216n }))
	await writeContractAndWait(client, () => client.writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'addQuestion', args: [questionId] }))
	return { portfolio, ...getSecurityPoolAddresses(zeroAddress, universeId, questionId, securityMultiplierBps, universeId, reportPriorityFeeAttoEthPerGas, portfolio) }
}
