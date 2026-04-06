import 'viem/window'
import { ReadClient, WriteClient } from './viem'
import { Address } from 'viem'
import { AnvilWindowEthereum } from '../AnvilWindowEthereum'
import { QuestionOutcome } from '../types/types'
export { sortStringArrayByKeccak } from './sortStringArrayByKeccak'
export declare const approveToken: (client: WriteClient, tokenAddress: Address, spenderAddress: Address) => Promise<`0x${string}`>
export declare const getERC20Balance: (client: ReadClient, tokenAddress: Address, ownerAddress: Address) => Promise<bigint>
export declare const getETHBalance: (client: ReadClient, address: Address) => Promise<bigint>
export declare const setupTestAccounts: (anvilWindowEthereum: AnvilWindowEthereum) => Promise<void>
export declare function ensureProxyDeployerDeployed(client: WriteClient): Promise<void>
export declare const contractExists: (client: ReadClient, contract: `0x${string}`) => Promise<boolean>
export declare function getChildUniverseId(parentUniverseId: bigint, outcome: bigint | QuestionOutcome): bigint
//# sourceMappingURL=utilities.d.ts.map
