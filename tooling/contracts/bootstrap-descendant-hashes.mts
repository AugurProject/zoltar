import type { Hash } from '@zoltar/core-shared/evm/ethereum'

/**
 * Runtime code hashes of the contracts that protocol factories create on first use.
 * `sepolia` covers Sepolia and any chain with Uniswap's published Sepolia WETH;
 * `deterministic` covers testnets whose WETH is the deterministic WETH9 deployment.
 * tooling/contracts/deployment-runtime-hashes.test.ts verifies every table on Anvil.
 */
export type BootstrapDescendantHashProfile = 'deterministic' | 'mainnet' | 'sepolia'

// Every descendant except the security pool deployer and its deployment worker hashes identically on all profiles.
const PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<string, Hash>> = {
	escalationGameCreationCodePartOne: '0x0007cdbe740fc4b9b70dc2fc709560f9a634da2f772bd00df0fccc6fc71b59e2',
	escalationGameCreationCodePartTwo: '0x66c7452003652e726589f4077a8a9b841c80c7b1d78686e372c7437d6f228dcb',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	oracleReportDelegate: '0xd7c634f77093dac7c3e4ce88edfcedbe6adf1c2dbd377cf13d400a1e1f79a8fa',
	priceCoordinatorCreationCodeFirstChunk: '0x9b15366af2f5f73eadb261dc037082e3d1e0b7ba293cf92498cc1579024c0809',
	priceCoordinatorCreationCodeSecondChunk: '0xc2b31bdf6480d9d297ed73ae8eadca6724d8ab0f7ed5a8b15d641d4f6979b984',
	securityPoolAuctionCreationCodeFirstChunk: '0x47d9fa8acd196d5d9fc471e20d6f2b6a3c619eebe5b1c0c0491712213e858673',
	securityPoolAuctionCreationCodeSecondChunk: '0xd5a7fc6106d229f78f6618850e5cdbe012bafd48134b2580e71c04858cc3457a',
	securityPoolAuctionVaultImplementation: '0x47f45a633096046d648a84f28bd91ef3250480df977380242d0c993f796b86fe',
	securityPoolCapitalCreationCodeFirstChunk: '0x6b9dfaf589800052661ace577daf2ac7e7bb2343edcbacc57bc8c8c8c74d766a',
	securityPoolCapitalCreationCodeSecondChunk: '0xa72f84ae7410e9df3c92f8ed5a29c6081156c5b20d4a1093abf5bb8a8335627b',
	securityPoolCreationCodeFirstChunk: '0x8efd1f85a6788769b72b3c45aca4d527b5e5c4e83c0bdd5126032735b630607c',
	securityPoolCreationCodeSecondChunk: '0xb6742714ec4a3509af11d8f81f63903e7fa774f277e6d994fe81fef300818c84',
	securityPoolForkCreationCodeFirstChunk: '0x03d4635993dc0b32cb5b36ca808319c43af1d80b15e1a65f8191d59c4cd90802',
	securityPoolForkCreationCodeSecondChunk: '0x1b3725b94aca0348ee54a973d2a92cab3a358509ade7bc9e1be778fa43f01d60',
	securityPoolServicesCreationCodeFirstChunk: '0xaee57462e658f749ba406285378bfa867b99f47a065f6dfd9915e9f0d7aca629',
	securityPoolServicesCreationCodeSecondChunk: '0xf93a3f7da8339f41d519c981f9ab07b5b02f511d1bbfe14f404e016604bbbdbc',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x8b3c385d9cbb46dd524f506df75bf430a32cefb715eed4c14fe69598fd7d27dd',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x20333e561f682fc145ae185361daa1e91dc0543386c024000e1e637e4ff45f4b',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x253d40a26406943fe8e8be99681866a842d114a7b9c9bbd69ef789c94362d8dc',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xf933c10391e3508d350fe2b78c9cad8d6c40a4971deba5605233077e1ef65b58',
	securityPoolCapitalFeeStreamsImplementation: '0xdbf59c9eb20314880d4ca610319f017abdab729718c154344162791b706a0d0b',
	securityPoolCommitmentIndexImplementation: '0xc2e834de06217b34b9c9bc8173d23c0d769355873e80694c273cfac71fbc1345',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x571d7196518c3a3f1c23f3c83d0f1cf3075d6ed9da2433e4cd5fc6d9b6aa8a54',
		securityPoolDeploymentWorker: '0xcd53bbb71f6ab29b23aeb26dc92b51a2e2d2ceb1ffa38f1dcb029e19ba23e3d4',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x6c1651adec37f08446e15ecd7ef02c4ae4269826ce46eb1bd9ff31aa36a7ef7f',
		securityPoolDeploymentWorker: '0x2e660517d09b369aca545f113675d23408217c88c1707bce869b855e73dbe5c3',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x4450538570da714770527fac39064364c6e2356a2d0414206e36b3e39525f7a3',
		securityPoolDeploymentWorker: '0xc60c8f943777ca3b5ccbd804c618eeae319ecc40569f1cca502b21d65616b358',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x8cf2206d43a8baf83682413b39e8cdaa669e75668cc54b9221d49aa2d3d083eb',
		securityPoolDeploymentWorker: '0x63f1c00fd539ce0b9ead8de75790ec25eeb404ace79010f7c2414fe9da1021cb',
	},
	deterministic: {
		securityPoolDeployer: '0x1cebd3349bba5ce7d082d61f0d50b76f1b7a26c0277969ff15948e48db593abc',
		securityPoolDeploymentWorker: '0x5af2ccc267cb8645e08ea7f9921d9535cfd5bac9dbdf963d9d689d1a6e2f3fe8',
	},
	mainnet: {
		securityPoolDeployer: '0xab8fa68592197123ade5be7d87481af3414a56cc203d9b833483f46ad004fc93',
		securityPoolDeploymentWorker: '0x06928a4a8e03a441be3007e8fa981589bcaba282352eebbd65e9886079b0856b',
	},
}
