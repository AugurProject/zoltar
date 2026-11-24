import type { Hash } from '@zoltar/core-shared/evm/ethereum'

/**
 * Runtime code hashes of the contracts that protocol factories create on first use.
 * `sepolia` covers Sepolia and any chain with Uniswap's published Sepolia WETH;
 * `deterministic` covers testnets whose WETH is the deterministic WETH9 deployment.
 * tooling/contracts/deployment-runtime-hashes.test.ts verifies every table on Anvil.
 */
export type BootstrapDescendantHashProfile = 'deterministic' | 'mainnet' | 'sepolia'

// Every descendant except the question ledger deployer and its deployment worker hashes identically on all profiles.
const PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<string, Hash>> = {
	securityPoolCapitalAuctionDelegate: '0x0e84ea264e030bd24429af5dc1440a3dbe9492dcc00260db8d577bdddb7b4947',
	securityPoolCapitalLifecycleDelegate: '0xd6919de47ed27dea6e7a610a5eb0c4ddaad5cf6b95bca86ae67d2dadd3bf55bb',
	escalationGameCreationCodePartOne: '0x9582a749eb98b9d3eb028db8ac19f263707d7e43854a2e0c3f865cea80c2c1cb',
	escalationGameCreationCodePartTwo: '0x2bc272d7e3961969d3bd2ddea3705232f62d8b460e90afadf678f673ef1fd61a',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	oracleReportDelegate: '0xd7c634f77093dac7c3e4ce88edfcedbe6adf1c2dbd377cf13d400a1e1f79a8fa',
	priceCoordinatorCreationCodeFirstChunk: '0x7f4defb0f8f191ef1a9e967053a3d68c215e5df7ccfb711171896eb792e4ffec',
	priceCoordinatorCreationCodeSecondChunk: '0xe19ab3422fc10443e660418b10a9519f4944e595f81f8c30d6967f5f51f05ab9',
	securityPoolAuctionCreationCodeFirstChunk: '0x12ccc99032df2497ef823f3705ae8ed258bf3fe2ec8f08164c38a1221e39d55f',
	securityPoolAuctionCreationCodeSecondChunk: '0x2aadfffac4f84229eb0b88498ed8cc7b18804179ffd9c699031a13fc31486ca0',
	securityPoolAuctionVaultImplementation: '0x9de92ef573ade6c6a9116be69c4b1bbbfd0ea01a198c079d8cec6c84894164f5',
	securityPoolCapitalCreationCodeFirstChunk: '0x3bc5eead13bc196959284409173cc7037734af3d63855acbbcf2dbdbf63a8069',
	securityPoolCapitalCreationCodeSecondChunk: '0x2d2c65c6eedc5263d36cd14ea8e7be496506799bdd7eae593cf8e5811ffe3639',
	questionLedgerCreationCodeFirstChunk: '0x4294702243e050005ec819652bb173291a955a56514b907d1a6f797c15e060f2',
	questionLedgerCreationCodeSecondChunk: '0x4f3f163cd3da474eef6e7f4aa10aeacde24b5cd3d88e548e4ac29f25e085ff42',
	securityPoolForkCreationCodeFirstChunk: '0xfab8deb0e4eb42dce68161d504800451cad3e02d72767b6a6f6ef7a2b57b3114',
	securityPoolForkCreationCodeSecondChunk: '0x93dd449509d04c46d888d905f3b36b9d631c3505fe4589f15e10b7efd18099ca',
	securityPoolServicesCreationCodeFirstChunk: '0x76c44a1014995cbc70dc305e47e68580535e5a1d08c2b69952b980c364771b92',
	securityPoolServicesCreationCodeSecondChunk: '0xd1ca0393d92e0cf14c43f2e4ffe383b082bddc5094a4f159c4a16587fd571644',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x3025286e02de6c5c2daf7742260659cf615f3404af5a10f0d77858d48ae4d500',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x12782ba3a2f95bb7fcf56e759866755de081ad82010bde8607031f4254acfaad',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xdca6560084377f02a30bfeacc7fbb3896bc9a7df39765b018a7d0a801497321d',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0x94dddd5e3fbe8fa099b6f6b744d501083c1c269c466d89c2352d398ce2df8db4',
	securityPoolCapitalFeeStreamsImplementation: '0x370a1c9ef5398165e1e7c5adbb892b6d28b6bdbda95e89d2d648ee62a6dc3783',
	securityPoolCommitmentIndexImplementation: '0x53f7a7051fb572ef2981e0fa2b27862aea4d89ca0f1f56b106fee39a45ce44a8',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xb2c44eb4cb7dfedafa5f67ea6a2d605b8a9cb9736e4d7388eca33d3c190a6966',
		questionLedgerDeploymentWorker: '0x352aea2e4748239d67f7329605d2b2020ce4c7f0351cb72adededbdd02fafe43',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x37c26828516b08129eebc82495f22ee910a31faeb06ace8e58b506c50684999f',
		questionLedgerDeploymentWorker: '0x106dca2c4beb7ebf60365d7f1af793718232a301bf72e4d4194badf24c263d64',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x08fcb8957654c75b49a766d62baf0bc92e1cce078b01269d5e29c852ea7b83c2',
		questionLedgerDeploymentWorker: '0x9d322d3d116d4f90b293be39ea3c8abcc33857d5ba88a21075e16624d432779c',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x88e39fddc5b0fd36d984580166f6c551fdae0a3e01b5309841b793286bc0e1a2',
		questionLedgerDeploymentWorker: '0x9aaee69dd33d6fdd5e54c6399301bb174256e6161c35985e93dd7fa75a7bbaa4',
	},
	deterministic: {
		questionLedgerDeployer: '0x2f8058c961cf9678aba32275d52122b2e80d09e887eedc2651a33214a49771c2',
		questionLedgerDeploymentWorker: '0x08fff396ebfe14b77337c9cef6206faa8ad931946c65f0073adf48d9f10af31e',
	},
	mainnet: {
		questionLedgerDeployer: '0x4711da0a5be4075ad71151e5b6361f4e52480d74647c07c6eef70df6851b842d',
		questionLedgerDeploymentWorker: '0x031bb608abf52baf7ae6df9026d377889d3313e32f8aea3e9879e7f3e3a40486',
	},
}
