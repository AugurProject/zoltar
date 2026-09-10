// These imported compatibility contracts provide neutral infrastructure; their
// on-disk location does not make WETH or Multicall a Statoblast dependency.
const infrastructureContracts = new Set(['contracts/statoblast/WETH9.sol', 'contracts/statoblast/Multicall3.sol']);
export function contractProjectOwner(sourcePath) {
    if (sourcePath.startsWith('contracts/trading/'))
        return 'trading';
    if (sourcePath.startsWith('contracts/statoblast/') && !infrastructureContracts.has(sourcePath))
        return 'statoblast';
    return 'zoltar';
}
export function isContractProjectSource(sourcePath, project) {
    if (sourcePath.startsWith('contracts/test/') || sourcePath.startsWith('contracts/chaos/') || sourcePath.includes('/test/'))
        return false;
    const owner = contractProjectOwner(sourcePath);
    return project === 'trading' || owner === 'zoltar' || (project === 'statoblast' && owner === 'statoblast');
}
export function parseContractProject(value) {
    if (value !== 'zoltar' && value !== 'statoblast' && value !== 'trading')
        throw new Error(`Unknown contract project: ${value}`);
    return value;
}
