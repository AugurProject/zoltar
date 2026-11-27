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
	securityPoolCapitalRepairAuctionDelegate: '0xf73b58c41d17ab66f24514c1eed0d0794d29ed8ff5ffa44935f0e8781139585a',
	securityPoolCapitalLifecycleDelegate: '0x202879d948bb7005c3c3fa392a83617ecbeb4e0382addc68070636f08595740c',
	escalationGameCreationCodePartOne: '0x6c8b44be45827ab7f0b553848fd36fb9840f642d77ada716fbe1294c6e3bd587',
	escalationGameCreationCodePartTwo: '0x572a87ed56c577a57692ca951475256825262e35852edb0135a62cf84cf7d34e',
	escalationGameProofVerifier: '0x0fbe595430d3ba685500c339fadc1bca2bdfe8caa73ab0739f06d7a4a6962d4a',
	securityPoolAuctionCreationCodeFirstChunk: '0x1735d8431485d75c583c15cc3eb1ad95c38ce54a9be0690a01d612351832c863',
	securityPoolAuctionCreationCodeSecondChunk: '0xd367d632bada9c4744fc37658f2250a8380a86c209a7ba7e1eef6a1c422edbc0',
	securityPoolAuctionVaultImplementation: '0xb7544bdc5016ff8552e6568f409dbea33df44b46762b08e5ac15fd14043ae19d',
	securityPoolCapitalCreationCodeFirstChunk: '0x749b7fd03149280faf4182c1d9da4471dfbf1cc985fd0e558449db6560224683',
	securityPoolCapitalCreationCodeSecondChunk: '0x7ebb7166c6a27e881a6ea2e070d16c21131ddacb847026a1a0b795d45c37194d',
	questionLedgerCreationCodeFirstChunk: '0x691f11c60c59a18ebbbb3fcf5d5de304c0603d9e14aa8c33d59fa001f3a86e65',
	questionLedgerCreationCodeSecondChunk: '0xedfaf6d8c1139038d5e30bf2b9e09172187d6c681f5163f1ed83f872bb8e3a7f',
	securityPoolForkCreationCodeFirstChunk: '0x8c405312859e853d47476fc83f6377bc57d36bfe4d2ad29cde5a3e76dd796516',
	securityPoolForkCreationCodeSecondChunk: '0x077cd869189e8a76467100670caef018beca1d76d3af9e2fd9394a9b0ef11ad4',
	securityPoolServicesCreationCodeFirstChunk: '0x245b1c77df677b1aaaf5e5e04bfcc30294f0f6ccb39f5ed21e36274319ec2815',
	securityPoolServicesCreationCodeSecondChunk: '0x75e716048f18130f2cc270a7a79ad637ab512980e2603112af7620aaff585564',
	securityPoolSettlementBookCreationCodeFirstChunk: '0x99468618873223fdb2b76ad1cf81b8c39c610d0593d0962fd5c848654ef6b46f',
	securityPoolSettlementBookCreationCodeSecondChunk: '0x1342de21be3ffe97d7956d1ed0c80d1eceabd7093808016720be5c6e28192fe4',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x298c9277a921244626cff3adf6803b8e5fff7b90811af8cbf9ed295eab7d3820',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xa6a73a724f965075a412fd34a5b7ccd57368318d65c2f86fbd4311293a4ea393',
	securityPoolCapitalFeeStreamsImplementation: '0x0dea52dd3fc148fbedbd218f82c4afa1f13d245e40a9730bde1c0e65f9d46c08',
	securityPoolCommitmentIndexImplementation: '0x30ae30586e726b3c5f184156d1fbf9dce7b140dff17e00dd184ff47f8d7be07e',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x36c1098d3df8c556055383cd5e94dc0ac9701336ee37a1770541a4df73c280c9',
		questionLedgerDeploymentWorker: '0xd01dbe046024894086154e05e047e520d881a88fe1a11c4c837720404def1045',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0xbe2797d2f9d82d2b8037e48eaa9652ebd0de0c7cba3b86b379114e3e04467b4a',
		questionLedgerDeploymentWorker: '0x10416f5990f3907e8d769f7c1f321bdbee855daf6e888427af32419743ac4c01',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		questionLedgerDeployer: '0x8b69f90b5420a883f501960421b43e11c43f8396394162e8733694e16ba23dc8',
		questionLedgerDeploymentWorker: '0x1d62b25c9120c3e1015e1979d1c21f94fe193c03bc35b1e06965d7cd46e08c4c',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		questionLedgerDeployer: '0x2f915be0c1d1ea61c2c540cb4b8124c280be0e7014d166a2dec91af6ad1503fe',
		questionLedgerDeploymentWorker: '0xc3622d440382bc72af3749601f7ef01ea651c2b07be67453188f176afb842907',
	},
	deterministic: {
		questionLedgerDeployer: '0x2f50b3919ce670a3256f6b13f6d24442f5e7bf7730a9d1b6e9406217fb747e42',
		questionLedgerDeploymentWorker: '0x2fdc77d68529738c9033063d688d3837c48fedef076be15d365da856b3d44c54',
	},
	mainnet: {
		questionLedgerDeployer: '0xdf11d79ca4d9a475b2c6b47a88b08ef5c947e96e786534cc8191ba91d52ad6d6',
		questionLedgerDeploymentWorker: '0xecd2eff3ac32553d3b18ba76122a81bc46f3bf4ec55eb94af746ad6c9115b214',
	},
}
