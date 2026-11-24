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
	escalationGameCreationCodePartOne: '0x1f17bdabbdff2f2110ccbaaece91e9855f724389305b54595e302a4f6c238f9c',
	escalationGameCreationCodePartTwo: '0xd2d7fd9aa293d027bd67dae8117c98f95edc50fede0653fb35b77eeda6665cae',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	oracleReportDelegate: '0xd7c634f77093dac7c3e4ce88edfcedbe6adf1c2dbd377cf13d400a1e1f79a8fa',
	priceCoordinatorCreationCodeFirstChunk: '0x7f4defb0f8f191ef1a9e967053a3d68c215e5df7ccfb711171896eb792e4ffec',
	priceCoordinatorCreationCodeSecondChunk: '0xe19ab3422fc10443e660418b10a9519f4944e595f81f8c30d6967f5f51f05ab9',
	securityPoolAuctionCreationCodeFirstChunk: '0x0213bce4c7671edee55bf130585e991bec8940ddc9038622bd36a82b2d47adec',
	securityPoolAuctionCreationCodeSecondChunk: '0x5a005ad5bea9c439c06fc812488efef6fcf2e822f2798018b3d2e822d572c854',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0xfe6341a0415e785006b64be4ea683c777d013ca878819d338c5eecec99c33358',
	securityPoolCapitalCreationCodeSecondChunk: '0xf65531d186dced791af400f58e46145a2ec744c0aa0e2371700168ffcee5ab9b',
	questionLedgerCreationCodeFirstChunk: '0x15868d13b80fb30dba79cd96097ce00b64da02879718c10b42f3168b980c8a0c',
	questionLedgerCreationCodeSecondChunk: '0x8b6467cdb51e15fc044d3fa42ccbbd8dc0314e315f11fef8724509935195367d',
	securityPoolForkCreationCodeFirstChunk: '0x3392ad86b16ffca7d73750b741e04bca92bf7ad09903a0678be43fa9fde68c88',
	securityPoolForkCreationCodeSecondChunk: '0x414105676bf3250eb25c8f2792ae030ee2b222357892049f66fd9fcbce9d0e73',
	securityPoolServicesCreationCodeFirstChunk: '0x76c44a1014995cbc70dc305e47e68580535e5a1d08c2b69952b980c364771b92',
	securityPoolServicesCreationCodeSecondChunk: '0xd1ca0393d92e0cf14c43f2e4ffe383b082bddc5094a4f159c4a16587fd571644',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x3025286e02de6c5c2daf7742260659cf615f3404af5a10f0d77858d48ae4d500',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x12782ba3a2f95bb7fcf56e759866755de081ad82010bde8607031f4254acfaad',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0xdca6560084377f02a30bfeacc7fbb3896bc9a7df39765b018a7d0a801497321d',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xaf704fa30198d7092dea6c9e93152d34120046d349a8f9fdb5a9a15e348f06d9',
	securityPoolCapitalFeeStreamsImplementation: '0xa21a3feb00353bada6a3f48cb6f29f11a77d4bdccee2d6404b4fce3bcbf2fa5a',
	securityPoolCommitmentIndexImplementation: '0x88cbb0a074ce2c4313dbb1ff1589f22eb6109403f1d96f1b605a6b503e6424f5',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x56d7c5e1ed2d31da88ec3eee85bf8eb03f1c21c10fdeb050868f2ae5c3fe72d1',
		questionLedgerDeploymentWorker: '0x925be1f4b0463338f1fc710e3eb2a04aaa28e66bdc1ffed6e88bf1b5dac7c4d8',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xee5d4cdba660de2d70c89879ca3f3cafeff6e0461261dc2c12b08d2c84acd1dc',
		questionLedgerDeploymentWorker: '0x5f067410506b6041aaba54ac8bbe2e0e6d01a4a38f472df46f5606ca6c5c6a88',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xa35b306c92930765b580c57503129054571dc46a18aa2232ab5b9aa22d9aa752',
		questionLedgerDeploymentWorker: '0xe0e278dce1b564ca3c77a420c835de3308e36b3c72a77eefe3666393314cf7a0',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x4b2825743a6c459bd6b18569a249ea252c4a93fcc4a33476c2442f0ea78532e8',
		questionLedgerDeploymentWorker: '0x5d850f9f55676e46eedf7a711482afc8205951e3f5651f44006f44ba62733cef',
	},
	deterministic: {
		questionLedgerDeployer: '0x3e87254c6022ca477ddf27e2c1c96de8f0be4c52632248052d2026f681d830ed',
		questionLedgerDeploymentWorker: '0x4db17cd963cafcbff9cae00c3393bdee538d415975c0f91128bb3990bd65c970',
	},
	mainnet: {
		questionLedgerDeployer: '0xebe030bd3c3dbaccfebc679bb9eda9c93ca84b2c73f273cdad442216ec4a13fa',
		questionLedgerDeploymentWorker: '0x388a288e252017dfb73f0fb0ce9fa1d5050cde5c6eea6bc63def0ace5c0f338d',
	},
}
