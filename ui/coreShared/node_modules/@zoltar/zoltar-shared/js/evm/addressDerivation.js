import { getAddress, getCreate2Address, keccak256, numberToBytes } from '@zoltar/core-shared/evm/ethereum';
function deriveRepTokenAddress(universeId, genesisRepTokenAddress, zoltarAddress, reputationTokenInitCode) {
    if (universeId === 0n)
        return getAddress(genesisRepTokenAddress);
    return getCreate2Address({
        from: zoltarAddress,
        salt: numberToBytes(universeId, { size: 32 }),
        bytecodeHash: keccak256(reputationTokenInitCode),
    });
}
export function createRepTokenAddressHelper(config) {
    const getRepTokenAddress = (universeId) => {
        const zoltarAddress = config.getZoltarAddress();
        return deriveRepTokenAddress(universeId, config.genesisRepTokenAddress, zoltarAddress, config.getReputationTokenInitCode(zoltarAddress));
    };
    return {
        getRepTokenAddress,
    };
}
