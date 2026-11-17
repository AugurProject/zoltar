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
	escalationGameCreationCodePartOne: '0x242ce7c137ca6b7c01e54287713c6f120963d17f79845287409662c237305855',
	escalationGameCreationCodePartTwo: '0xf62139822dac2689459df02a607d5bfa58d76d1a8176e961ba7d520cb1760e3b',
	escalationGameProofVerifier: '0x37b5e9e91983a55ca32d9084a7a9e3442a89b73e1901c8bfc0cc3b7e006099a4',
	oracleReportDelegate: '0x501edaed1a7f5e323df3b193bfc494b495c390fe3e6013fd5e57dcb938415396',
	priceCoordinatorCreationCodeFirstChunk: '0x836ab6115d2e1b5beff05c885424cd37dacc7935236223d91cb33b969e713f28',
	priceCoordinatorCreationCodeSecondChunk: '0xdaec1c3423b63ceeb4fb43f55ffdfd4695f7ba41efc6fb3e2b2e96aad70c94d7',
	securityPoolAuctionCreationCodeFirstChunk: '0x87c68ce4be02c1314cc2a3c96d4695e5dad0f3db7ae14a73849cacbe5b31d3a6',
	securityPoolAuctionCreationCodeSecondChunk: '0xa7f49f45e915eb19883fa960924d7a1c05eebb9f5a3e2528289c35535da53e32',
	securityPoolAuctionVaultImplementation: '0x987f52a0a0ccaac98b7fef51307fdb88e50be3a5c6c384b068baef0dcd63cccd',
	securityPoolCapitalCreationCodeFirstChunk: '0x84baf3657948e2c0f7eb14364e1ae9f1b061265868d572fbb6a5d148f232847d',
	securityPoolCapitalCreationCodeSecondChunk: '0xdbff69b9c292b004da62c0142fdb72f8666593f94a8281835005f107b0026852',
	securityPoolCreationCodeFirstChunk: '0x2f53d0230588732dd053021349987514dd6a81d991c8522cad9aaa69197960bb',
	securityPoolCreationCodeSecondChunk: '0x27cd691d2f2c8a86620dbbee5e51340c2b6383958c444ed8ab8b91b3cadaf3a5',
	securityPoolForkCreationCodeFirstChunk: '0xff1010fb15e3cd5b13be685ed1f8c31b628db6ba5c54281dd3e8aab9d5b7bad4',
	securityPoolForkCreationCodeSecondChunk: '0x8f46b99358cf90a6acdade878e05f001e6ca02ca97964ed2be7ca02117b49591',
	securityPoolServicesCreationCodeFirstChunk: '0x6f9a626b08127bbb0822cf0d1b7621e9b5d0bf64f15735b3e1c0c76fe1390937',
	securityPoolServicesCreationCodeSecondChunk: '0xadae7873855726c8c706df59eb312e3f1da401a3f428f58c627467079e3e70ab',
	sharedPoolPriceFeedCreationCodeFirstChunk: '0x1cad7e9233fad438bb7625090c844fc26728d05e9073f5da061cf410e96163e1',
	sharedPoolPriceFeedCreationCodeSecondChunk: '0xd012e99c5c9ca9d726c87449513d1c614eef99c1f700bc50fdc579f5edf693a9',
}

export const EXPECTED_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x9232e0015b600bf6d91b5bb1c85dbb29c335483fe6246ce3df18ffa8623d395b',
		securityPoolDeploymentWorker: '0x58942b2ec2690d98d2e44aa864879b1fb269a95b8adcee51e82f457da4c0754d',
	},
	deterministic: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0xad04d757a9913bf1917bb574840dbc9e6a538f0c46540b87680c02c6b8bd0b48',
		securityPoolDeploymentWorker: '0xb2884fece229bffb64b87fd6471fa015bb28ab9636d4482d42d0ca85b1c099f6',
	},
	mainnet: {
		...PROFILE_INDEPENDENT_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES,
		securityPoolDeployer: '0x095fec5aba4734ae3a00eb09e95860abaef4cdf0000966b7984f3c4f08d4a788',
		securityPoolDeploymentWorker: '0x3e95d949ef793626d9babf2c5d7e93c0ac184fcc3615f203c937b07afcc693c8',
	},
}

// Only descendants that embed a selected Zoltar address differ between the two genesis deployments.
export const EXPECTED_NO_BOOTSTRAP_DESCENDANT_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<string, Hash>>>> = {
	sepolia: {
		securityPoolDeployer: '0x7b8d861ea534ceab868980a4933aa3429bc2acbb02b274e0d64c095757da6930',
		securityPoolDeploymentWorker: '0xb1660b8a23fe899cc54e33b71396b82f0b9e2424c0653e2d4d879e13978907ae',
	},
	deterministic: {
		securityPoolDeployer: '0xdf40e3c9feee97044b890b3386daed830a189321cfbffd1a5122d1f71c4e9aa7',
		securityPoolDeploymentWorker: '0x9b1808336e8cb94abccc4f16a0fde4b3a96ea5f33ba86cc6571d3be3c97db2b8',
	},
	mainnet: {
		securityPoolDeployer: '0x053125c4c561818d480cc6b5bd0d10dda0be67e2e5c825c87fc01ac2282ad0b7',
		securityPoolDeploymentWorker: '0x6e7181cbb6dc138e88d40b1564b7fdc39ed0ff9bb2e74c33842f5ff66b6cd6f2',
	},
}
