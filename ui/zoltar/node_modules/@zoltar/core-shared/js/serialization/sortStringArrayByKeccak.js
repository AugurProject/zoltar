import { encodeAbiParameters, keccak256 } from '../evm/ethereum.js';
function getStringHash(value) {
    return keccak256(encodeAbiParameters([{ type: 'string' }], [value]));
}
export function sortStringArrayByKeccak(inputStrings) {
    return [...inputStrings].sort((firstString, secondString) => {
        const firstHash = getStringHash(firstString);
        const secondHash = getStringHash(secondString);
        if (firstHash > secondHash)
            return -1;
        if (firstHash < secondHash)
            return 1;
        return 0;
    });
}
