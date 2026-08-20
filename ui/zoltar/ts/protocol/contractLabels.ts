import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import {
	ZoltarQuestionData_ZoltarQuestionData,
	Zoltar_Zoltar,
<<<<<<< HEAD:ui/zoltar/ts/protocol/contractLabels.ts
	peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	peripherals_SecurityPoolForker_SecurityPoolForker,
	peripherals_SecurityPool_SecurityPool,
	peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
	peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
	peripherals_openOracle_OpenOracle_OpenOracle,
	peripherals_tokens_ShareToken_ShareToken,
} from '@zoltar/ui-core-shared/contractArtifact.js'
=======
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	statoblast_SecurityPoolForker_SecurityPoolForker,
	statoblast_SecurityPool_SecurityPool,
	statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
	statoblast_openOracle_OpenOracle_OpenOracle,
	statoblast_tokens_ShareToken_ShareToken,
} from '../contractArtifact.js'
>>>>>>> origin/main:ui/ts/protocol/contractLabels.ts

const CONTRACT_LABEL_BY_ABI = new Map<readonly unknown[], string>([
	[ABIS.mainnet.erc20, 'ERC-20 Token'],
	[ZoltarQuestionData_ZoltarQuestionData.abi, 'Zoltar Question Data'],
	[Zoltar_Zoltar.abi, 'Zoltar'],
	[statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, 'Open Oracle Price Coordinator'],
	[statoblast_SecurityPoolForker_SecurityPoolForker.abi, 'Security Pool Forker'],
	[statoblast_SecurityPool_SecurityPool.abi, 'Security Pool'],
	[statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi, 'Truth Auction'],
	[statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi, 'Security Pool Factory'],
	[statoblast_openOracle_OpenOracle_OpenOracle.abi, 'Open Oracle'],
	[statoblast_tokens_ShareToken_ShareToken.abi, 'Share Token'],
])

export function getContractLabel(abi: readonly unknown[], functionName: string) {
	return CONTRACT_LABEL_BY_ABI.get(abi) ?? (functionName === 'deposit' ? 'WETH' : undefined)
}
