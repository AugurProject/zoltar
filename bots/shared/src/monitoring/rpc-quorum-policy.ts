import { rpcQuorumEnvironment, type ProcessEnvironment } from '../config/environment.ts'

export type RpcQuorumRequirement = 1 | 2

export function rpcQuorumRequirement(environment: ProcessEnvironment = process.env): RpcQuorumRequirement {
	return rpcQuorumEnvironment(environment)
}

export function configuredReadRpcEndpointMinimum(requirement: RpcQuorumRequirement) {
	return requirement === 1 ? 1 : 3
}

export function configuredQuorumRpcUrlMinimum(requirement: RpcQuorumRequirement) {
	return configuredReadRpcEndpointMinimum(requirement) - 1
}

export function rpcQuorumDescription(requirement: RpcQuorumRequirement) {
	return requirement === 1 ? 'one RPC endpoint' : 'two independent RPC endpoints'
}
