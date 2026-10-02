import {
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	statoblast_SecurityPoolForker_SecurityPoolForker,
	statoblast_SecurityPool_SecurityPool,
	statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
	statoblast_openOracle_OpenOracle_OpenOracle,
	statoblast_tokens_ShareToken_ShareToken,
} from '../contractArtifact.js'
import { installAppContractLabelResolver } from '@zoltar/ui-zoltar-shared/protocol/core.js'

const CONTRACT_LABEL_BY_ABI = new Map<readonly unknown[], string>([
	[statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, 'OpenOraclePriceCoordinator'],
	[statoblast_SecurityPoolForker_SecurityPoolForker.abi, 'SecurityPoolForker'],
	[statoblast_SecurityPool_SecurityPool.abi, 'SecurityPool'],
	[statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi, 'UniformPriceDualCapBatchAuction'],
	[statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi, 'SecurityPoolFactory'],
	[statoblast_openOracle_OpenOracle_OpenOracle.abi, 'OpenOracle'],
	[statoblast_tokens_ShareToken_ShareToken.abi, 'ShareToken'],
])

export function installStatoblastContractLabels() {
	installAppContractLabelResolver(abi => CONTRACT_LABEL_BY_ABI.get(abi))
}
