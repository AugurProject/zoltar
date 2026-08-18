import { peripherals_SecurityPool_SecurityPool } from '@zoltar/ui-core-shared/contractArtifact.js';
import { writeContractAndWait } from '@zoltar/ui-zoltar/protocol/core.js';
export async function depositRepToVaultToSecurityPool(client, securityPoolAddress, amount, targetHealthFactorBps = 10000n) {
    if (amount <= 0n)
        throw new Error('REP deposit amount must be greater than zero');
    if (targetHealthFactorBps < 10000n)
        throw new Error('Target health factor must be at least 1.00×');
    const hash = await writeContractAndWait(client, () => ({
        address: securityPoolAddress,
        abi: peripherals_SecurityPool_SecurityPool.abi,
        functionName: 'depositRepToVault',
        args: [amount, targetHealthFactorBps],
    }));
    return {
        action: 'depositRepToVault',
        hash,
    };
}
export async function updateSecurityVaultFees(client, securityPoolAddress, vaultAddress) {
    const hash = await writeContractAndWait(client, () => ({
        address: securityPoolAddress,
        abi: peripherals_SecurityPool_SecurityPool.abi,
        functionName: 'updateVaultFees',
        args: [vaultAddress],
    }));
    return {
        action: 'updateVaultFees',
        hash,
    };
}
export async function redeemSecurityVaultFees(client, securityPoolAddress, vaultAddress) {
    const hash = await writeContractAndWait(client, () => ({
        address: securityPoolAddress,
        abi: peripherals_SecurityPool_SecurityPool.abi,
        functionName: 'redeemFees',
        args: [vaultAddress],
    }));
    return {
        action: 'redeemFees',
        hash,
    };
}
export async function redeemRepFromVaultFromSecurityPool(client, securityPoolAddress, vaultAddress) {
    const hash = await writeContractAndWait(client, () => ({
        address: securityPoolAddress,
        abi: peripherals_SecurityPool_SecurityPool.abi,
        functionName: 'redeemRepFromVault',
        args: [vaultAddress],
    }));
    return {
        action: 'redeemRepFromVault',
        hash,
    };
}
//# sourceMappingURL=securityVault.js.map