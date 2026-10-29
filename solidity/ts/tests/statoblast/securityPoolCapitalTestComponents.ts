import { encodeDeployData } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalLedgerDeployer as capitalDeployer, test_statoblast_CapitalLedgerHarness_CapitalLedgerTestComponents as components } from '../../types/contractArtifact'
import type { WriteClient } from '../../testSupport/simulator/utils/clients'

export async function deployCapitalTestComponents(client: WriteClient) {
	const deployer = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: `0x${capitalDeployer.evm.bytecode.object}` }) })
	if (deployer.contractAddress === undefined) throw new Error('Capital deployer address missing')
	return client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: components.abi, bytecode: `0x${components.evm.bytecode.object}`, args: [deployer.contractAddress] }) }) })
}
