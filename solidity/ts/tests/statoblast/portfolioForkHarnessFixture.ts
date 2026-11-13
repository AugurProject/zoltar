import { encodeDeployData, type Hex } from '@zoltar/core-shared/evm/ethereum'
import {
	test_statoblast_PortfolioForkHarness_PortfolioForkHarness as rootArtifact,
	test_statoblast_PortfolioForkHarness_PortfolioForkZoltarMock as zoltarArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuctionDeployer as auctionDeployerArtifact,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalLedgerDeployer as capitalDeployerArtifact,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCommitmentIndexDeployer as indexDeployerArtifact,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer as streamsDeployerArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
} from '../../types/contractArtifact'
import { deployContract } from '../../testSupport/deployContract'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'

/** Deploys the portfolio fork harness root with the real capital, settlement, book, reporter, and fork-coordinator modules, and returns its universe-zero capital ledger. */
export async function deployPortfolioForkHarness(owner: WriteClient) {
	const deploy = async (data: Hex) => await deployContract(owner, data)
	const zoltar = await deploy(`0x${zoltarArtifact.evm.bytecode.object}`)
	const capitals = await deploy(`0x${capitalDeployerArtifact.evm.bytecode.object}`)
	const indices = await deploy(`0x${indexDeployerArtifact.evm.bytecode.object}`)
	const streams = await deploy(`0x${streamsDeployerArtifact.evm.bytecode.object}`)
	const auctions = await deploy(`0x${auctionDeployerArtifact.evm.bytecode.object}`)
	const root = await deploy(encodeDeployData({ abi: rootArtifact.abi, bytecode: `0x${rootArtifact.evm.bytecode.object}`, args: [zoltar, capitals, indices, streams, auctions] }))
	const collateral = await owner.readContract({ abi: rootArtifact.abi, address: root, functionName: 'collateralToken' })
	const engine = await deploy(encodeDeployData({ abi: settlementArtifact.abi, bytecode: `0x${settlementArtifact.evm.bytecode.object}`, args: [root, collateral] }))
	const book = await deploy(encodeDeployData({ abi: bookArtifact.abi, bytecode: `0x${bookArtifact.evm.bytecode.object}`, args: [engine, 10n ** 12n] }))
	const reporter = await deploy(encodeDeployData({ abi: reporterArtifact.abi, bytecode: `0x${reporterArtifact.evm.bytecode.object}`, args: [root, zoltar] }))
	const forks = await deploy(encodeDeployData({ abi: forkArtifact.abi, bytecode: `0x${forkArtifact.evm.bytecode.object}`, args: [root, zoltar] }))
	await writeContractAndWait(owner, () => owner.writeContract({ abi: rootArtifact.abi, address: root, functionName: 'initialize', args: [engine, book, reporter, forks] }))
	const capital = await owner.readContract({ abi: rootArtifact.abi, address: root, functionName: 'capitalLedger', args: [0n] })
	return { zoltar, root, engine, forks, capital }
}
