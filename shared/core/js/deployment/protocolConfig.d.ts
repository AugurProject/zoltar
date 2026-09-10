export type ProtocolConfig = {
    forkBurnDivisor: bigint;
    forkThresholdDivisor: bigint;
    minimumSecurityBondDebtAttoEth: bigint;
    minimumVaultRepDepositAttoRep: bigint;
};
export type ProtocolConfigInput = Partial<{
    [key in keyof ProtocolConfig]: bigint | number | string | undefined;
}>;
export declare const DEFAULT_FORK_BURN_DIVISOR = 5n;
export declare const DEFAULT_FORK_THRESHOLD_DIVISOR = 20n;
export declare const DEFAULT_MINIMUM_SECURITY_BOND_DEBT_ATTO_ETH: bigint;
export declare const DEFAULT_MINIMUM_VAULT_REP_DEPOSIT_ATTO_REP = 0n;
export declare const DEFAULT_PROTOCOL_CONFIG: ProtocolConfig;
export declare const MAINNET_PROTOCOL_CONFIG: ProtocolConfig;
export declare function validateProtocolConfig(config: ProtocolConfigInput): ProtocolConfig;
export declare function getProtocolConfig(overrides?: ProtocolConfigInput): ProtocolConfig;
export declare function assertMainnetProtocolConfigFrozen(overrides?: ProtocolConfigInput): ProtocolConfig;
export declare function getMainnetProtocolConfig(overrides?: ProtocolConfigInput): ProtocolConfig;
