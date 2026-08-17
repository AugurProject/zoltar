import { createMemoryClient } from 'tevm';
import { type Hash } from '@zoltar/shared/ethereum';
export declare const SIMULATION_INITIAL_TIMESTAMP = 1735689600n;
export declare const SIMULATION_BLOCK_INTERVAL_SECONDS = 1n;
type TevmLikeClient = ReturnType<typeof createMemoryClient>;
export declare function getSimulationChainTimestamp(memoryClient: TevmLikeClient): Promise<bigint>;
export declare function getNextSimulationTimestamp(currentTimestamp: bigint): bigint;
export declare function minePendingSimulationTransactionAtTimestamp(memoryClient: TevmLikeClient, txHash: Hash, timestamp: bigint): Promise<`0x${string}`>;
export declare function mineNextSimulationBlock(memoryClient: TevmLikeClient): Promise<void>;
export declare function advanceSimulationTime(memoryClient: TevmLikeClient, seconds: bigint): Promise<void>;
export declare function initializeSimulationClock(memoryClient: TevmLikeClient, initialTimestamp?: bigint): Promise<bigint>;
export {};
//# sourceMappingURL=clock.d.ts.map