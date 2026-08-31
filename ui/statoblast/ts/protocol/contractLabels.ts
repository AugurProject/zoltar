import {
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	statoblast_SecurityPoolForker_SecurityPoolForker,
	statoblast_SecurityPool_SecurityPool,
	statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
	statoblast_openOracle_OpenOracle_OpenOracle,
	statoblast_tokens_ShareToken_ShareToken,
} from '@zoltar/ui-core-shared/contractArtifact.js'
import { installAppContractLabelResolver } from '@zoltar/ui-zoltar/protocol/core.js'

const CONTRACT_LABEL_BY_ABI = new Map<readonly unknown[], string>([
	[statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, 'Open Oracle Price Coordinator'],
	[statoblast_SecurityPoolForker_SecurityPoolForker.abi, 'Security Pool Forker'],
	[statoblast_SecurityPool_SecurityPool.abi, 'Security Pool'],
	[statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi, 'Truth Auction'],
	[statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi, 'Security Pool Factory'],
	[statoblast_openOracle_OpenOracle_OpenOracle.abi, 'Open Oracle'],
	[statoblast_tokens_ShareToken_ShareToken.abi, 'Share Token'],
])

export function installStatoblastContractLabels() {
	installAppContractLabelResolver(abi => CONTRACT_LABEL_BY_ABI.get(abi))
}
