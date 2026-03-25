import type { Address, Hash, Hex } from 'viem'

export type DeploymentStepId = 'proxyDeployer' | 'uniformPriceDualCapBatchAuctionFactory' | 'scalarOutcomes' | 'securityPoolUtils' | 'openOracle' | 'zoltarQuestionData' | 'zoltar' | 'shareTokenFactory' | 'priceOracleManagerAndOperatorQueuerFactory' | 'securityPoolForker' | 'escalationGameFactory' | 'securityPoolFactory'

export type QuestionData = {
	title: string
	description: string
	startTime: bigint
	endTime: bigint
	numTicks: bigint
	displayValueMin: bigint
	displayValueMax: bigint
	answerUnit: string
}

export type DeploymentClient = {
	getCode: (parameters: { address: Address }) => Promise<Hex | undefined>
	sendTransaction: (parameters: { to?: Address; data?: Hex; value?: bigint }) => Promise<Hash>
	sendRawTransaction: (parameters: { serializedTransaction: Hex }) => Promise<Hash>
	waitForTransactionReceipt: (parameters: { hash: Hash }) => Promise<unknown>
}

export type DeploymentReadClient = {
	getCode: (parameters: { address: Address }) => Promise<Hex | undefined>
}

export type BalanceReadClient = {
	readContract: (parameters: { abi: readonly unknown[]; functionName: string; address: Address; args: readonly unknown[] }) => Promise<unknown>
}

export type MarketWriteClient = {
	writeContract: (parameters: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) => Promise<Hash>
	waitForTransactionReceipt: (parameters: { hash: Hash }) => Promise<unknown>
}

export type DeploymentStep = {
	id: DeploymentStepId
	label: string
	address: Address
	dependencies: DeploymentStepId[]
	deploy: (client: DeploymentClient) => Promise<Hash>
}

export type DeploymentStatus = DeploymentStep & {
	deployed: boolean
}

export type MarketCreationResult = {
	questionId: string
	createQuestionHash: Hash
	deployPoolHash: Hash
}
