import { encodeDeployData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { buildSecurityPoolDeploymentRequest, buildSecurityPoolPrepareNextRequest, securityPoolAddressFromDeploymentLogs } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { statoblast_SecurityPool_SecurityPool as securityPoolArtifact, statoblast_SecurityPoolOpenAdmissionPolicy_SecurityPoolOpenAdmissionPolicy as policyArtifact } from '../../../../types/contractArtifact'
import { deployContract } from '../../../deployContract'
import { type WriteClient, writeContractAndWait } from '../clients'
import { getInfraContractAddresses, getQuestionLedgerAddresses } from './deployStatoblast'

/** The protocol's security pool module deployers, as `buildSecurityPoolDeploymentRequest` expects them. */
export function getTestSecurityPoolDeployers() {
	const infrastructure = getInfraContractAddresses()
	return {
		capital: infrastructure.securityPoolCapitalLedgerDeployer,
		commitments: infrastructure.securityPoolCommitmentIndexDeployer,
		fees: infrastructure.securityPoolCapitalFeeStreamsDeployer,
		books: infrastructure.securityPoolSettlementBookDeployer,
		settlement: infrastructure.securityPoolSettlementDeployer,
		reporters: infrastructure.securityPoolReporterLedgerDeployer,
		forks: infrastructure.securityPoolForkCoordinatorDeployer,
		repairAuctions: infrastructure.securityPoolRepairAuctionDeployer,
		services: infrastructure.securityPoolServicesDeployer,
	}
}

/** A fully prepared native security pool with one registered question and no owner capital. */
export async function deployTestSecurityPool(client: WriteClient, universeId: bigint, questionId: bigint, securityMultiplierBps: bigint) {
	const infrastructure = getInfraContractAddresses()
	const questionAdmissionPolicy = await deployContract(client, encodeDeployData({ abi: policyArtifact.abi, bytecode: `0x${policyArtifact.evm.bytecode.object}` }))
	const reportPriorityFeeAttoEthPerGas = DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS
	const request = buildSecurityPoolDeploymentRequest({
		owner: client.account.address,
		factory: infrastructure.securityPoolFactory,
		origin: { collateralToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', minimumReportCollateral: 10n ** 16n, universeId, securityMultiplierBps, reportPriorityFeeAttoEthPerGas },
		maximumQuestionHorizonSeconds: 20n * 365n * 86_400n,
		questionAdmissionPolicy,
		economics: { purchaseFeeBps: 100n, annualFeeBps: 1_000n, minimumPurchaseFeeAttoEth: 10n ** 15n, minimumCommitmentAttoEth: 10n ** 16n, minimumOutcomeRate: 1_000n, rewardVestingSeconds: 86_400n },
		creationCode: `0x${securityPoolArtifact.evm.bytecode.object}`,
	})
	const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ ...request, gas: 16_777_216n }) })
	if (receipt.status !== 'success') throw new Error('Test security pool deployment failed')
	const securityPool = securityPoolAddressFromDeploymentLogs(receipt.logs, infrastructure.securityPoolFactory)
	for (let stage = 0; stage < 4; stage++) await writeContractAndWait(client, () => client.sendTransaction({ ...buildSecurityPoolPrepareNextRequest({ caller: client.account.address, securityPool }), gas: 16_777_216n }))
	await writeContractAndWait(client, () => client.writeContract({ abi: securityPoolArtifact.abi, address: securityPool, functionName: 'addQuestion', args: [questionId] }))
	return { securityPool, ...getQuestionLedgerAddresses(zeroAddress, universeId, questionId, securityMultiplierBps, universeId, reportPriorityFeeAttoEthPerGas, securityPool) }
}
