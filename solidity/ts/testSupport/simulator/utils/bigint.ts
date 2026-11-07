import type { Address } from '@zoltar/core-shared/evm/ethereum'

export const addressString = (address: bigint): Address => `0x${address.toString(16).padStart(40, '0')}`
