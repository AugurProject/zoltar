export type ProtocolConfig = {
	forkBurnDivisor: bigint
	forkThresholdDivisor: bigint
}

const DEFAULT_FORK_BURN_DIVISOR = 5n
const DEFAULT_FORK_THRESHOLD_DIVISOR = 20n

export const DEFAULT_PROTOCOL_CONFIG: ProtocolConfig = {
	forkBurnDivisor: DEFAULT_FORK_BURN_DIVISOR,
	forkThresholdDivisor: DEFAULT_FORK_THRESHOLD_DIVISOR,
}
