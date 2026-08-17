import { ABIS } from '../abis.js'
import {
	ZoltarQuestionData_ZoltarQuestionData,
	Zoltar_Zoltar,
	peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	peripherals_SecurityPoolForker_SecurityPoolForker,
	peripherals_SecurityPool_SecurityPool,
	peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
	peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
	peripherals_openOracle_OpenOracle_OpenOracle,
	peripherals_tokens_ShareToken_ShareToken,
} from '../contractArtifact.js'

const CONTRACT_LABEL_BY_ABI = new Map<readonly unknown[], string>([
	[ABIS.mainnet.erc20, 'ERC-20 Token'],
	[ZoltarQuestionData_ZoltarQuestionData.abi, 'Zoltar Question Data'],
	[Zoltar_Zoltar.abi, 'Zoltar'],
	[peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, 'Open Oracle Price Coordinator'],
	[peripherals_SecurityPoolForker_SecurityPoolForker.abi, 'Security Pool Forker'],
	[peripherals_SecurityPool_SecurityPool.abi, 'Security Pool'],
	[peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi, 'Truth Auction'],
	[peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi, 'Security Pool Factory'],
	[peripherals_openOracle_OpenOracle_OpenOracle.abi, 'Open Oracle'],
	[peripherals_tokens_ShareToken_ShareToken.abi, 'Share Token'],
])

export function getContractLabel(abi: readonly unknown[], functionName: string) {
	return CONTRACT_LABEL_BY_ABI.get(abi) ?? (functionName === 'deposit' ? 'WETH' : undefined)
}
