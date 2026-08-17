export type RpcQuorumRequirement = 1 | 2

type Environment = Readonly<Record<string, string | undefined>>

export function rpcQuorumRequirement(environment: Environment = process.env): RpcQuorumRequirement {
	const configured = environment['ZOLTAR_BOT_RPC_QUORUM']
	if (configured === undefined || configured === '2') return 2
	if (configured === '1') return 1
	throw new Error('ZOLTAR_BOT_RPC_QUORUM must be 1 or 2')
}

export function configuredReadRpcEndpointMinimum(environment: Environment = process.env) {
	return rpcQuorumRequirement(environment) === 1 ? 1 : 3
}

export function configuredQuorumRpcUrlMinimum(environment: Environment = process.env) {
	return configuredReadRpcEndpointMinimum(environment) - 1
}

export function rpcQuorumDescription(requirement = rpcQuorumRequirement()) {
	return requirement === 1 ? 'one RPC endpoint' : 'two independent RPC endpoints'
}
