import { type Address, type Hex } from '@zoltar/shared/ethereum';
import type { ReadClient } from '@zoltar/ui-core-shared/lib/clients.js';
import { getWethAddress } from './activeProtocolAddresses.js';
export { getWethAddress };
export declare const UNISWAP_V4_QUOTER_ADDRESS: any;
export declare const REP_ADDRESS: Address;
export declare const USDC_ADDRESS: any;
export declare const WETH_ADDRESS: Address;
export declare const ETH_ADDRESS: Address;
type PoolConfig = {
    fee: number;
    tickSpacing: number;
    hooks?: Address;
};
type UniswapV4QuoteSource = {
    poolConfig: PoolConfig;
    poolId: Hex;
    poolUrl: string;
    protocol: 'v4';
};
type UniswapV3QuoteSource = {
    fee: number;
    poolAddress: Address | undefined;
    poolUrl: string | undefined;
    protocol: 'v3';
};
type MockQuoteSource = {
    label: 'MOCK';
    poolUrl: undefined;
    protocol: 'mock';
};
export declare const DEFAULT_POOL_CONFIG: PoolConfig;
export declare function getRepAddress(): any;
export declare function isRepPricingEnabled(): boolean;
export declare function buildUniswapV4PoolId(tokenA: Address, tokenB: Address, poolConfig: PoolConfig): Hex;
export declare function buildUniswapV4PoolUrl(tokenA: Address, tokenB: Address, poolConfig: PoolConfig): string;
export declare function buildUniswapV3PoolUrl(poolAddress: Address): string;
export declare function quoteExactInput(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, poolConfig?: PoolConfig): Promise<bigint>;
export declare function quoteBestExactInputWithSource(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, poolConfigs?: readonly PoolConfig[]): Promise<{
    amountOut: bigint;
    source: UniswapV4QuoteSource | MockQuoteSource;
}>;
export declare function quoteBestExactInput(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, poolConfigs?: readonly PoolConfig[]): Promise<bigint>;
export declare function quoteTokenForEth(client: ReadClient, token: Address, amountIn: bigint, poolConfig?: PoolConfig): Promise<bigint>;
export declare function quoteEthForToken(client: ReadClient, token: Address, amountIn: bigint, poolConfig?: PoolConfig): Promise<bigint>;
export declare function quoteRepForEth(client: ReadClient, attoRepAmount: bigint): Promise<bigint>;
export declare function quoteEthForRep(client: ReadClient, ethAmountAttoEth: bigint): Promise<bigint>;
export declare function quoteBestV3ExactInputWithSource(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, fees?: readonly number[]): Promise<{
    amountOut: bigint;
    source: UniswapV3QuoteSource | MockQuoteSource;
}>;
export declare function quoteBestV3ExactInput(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, fees?: readonly number[]): Promise<bigint>;
export declare function quoteRepForEthV3(client: ReadClient, attoRepAmount: bigint): Promise<bigint>;
export declare function quoteRepForUsdcV4WithSource(client: ReadClient, attoRepAmount: bigint): Promise<{
    amountOut: bigint;
    source: UniswapV4QuoteSource | MockQuoteSource;
}>;
//# sourceMappingURL=uniswapQuoter.d.ts.map