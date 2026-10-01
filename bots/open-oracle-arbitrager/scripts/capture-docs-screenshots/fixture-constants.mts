import { getAddress, keccak256, toHex } from '@zoltar/bot-shared/ethereum'
import { publicOperatorFailure, publicPollFailure } from '@zoltar/bot-shared/dashboard/public-failures'

export const address = (value: number) => getAddress(`0x${value.toString(16).padStart(40, '0')}`)
export const transactionHash = (label: string) => keccak256(toHex(label))
export const now = Date.now()
export const sampledAt = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString()
export const wallet = address(0xa11ce)
export const rep = getAddress('0x221657776846890989a759BA2973e427DfF5C9bB')
export const repYes = address(0x1_0001)
export const repNo = address(0x1_0002)
export const openOracle = address(0x0a11ce)
export const executor = address(0xecec)
export const pool = address(0x3000)
export const hash = transactionHash('open-oracle-documentation-fixture')
export const checkedAt = sampledAt(0)

/** A credential fragment embedded in raw provider failures; no captured page may ever show it. */
export const protectedFailureMarker = 'operator-secret'
const longProviderFailureDetail = ` ${'provider response detail '.repeat(30).trim()}`
export const rawRpcFailure = `RPC https://operator:${protectedFailureMarker}@rpc.example/private/provider-key returned HTTP 400 while calling eth_getLogs:${longProviderFailureDetail}`
export const rawRelayFailure = `Private relay https://operator:${protectedFailureMarker}@relay.example rejected the transaction:${longProviderFailureDetail}`
export const rawNonPollFailure = 'Risk policy requires operator attention'
export const expectedRpcPollFailure = publicPollFailure(rawRpcFailure)
export const expectedRpcOperatorFailure = publicOperatorFailure(rawRpcFailure)
export const expectedNonPollFailure = publicOperatorFailure(rawNonPollFailure)
export const expectedStateUnavailableFailure = `${publicPollFailure('fixture state endpoint unavailable', 'load the latest operator state for the dashboard')} Use Refresh to retry now.`
