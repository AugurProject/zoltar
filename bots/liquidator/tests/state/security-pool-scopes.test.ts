import type { Hex } from '@zoltar/bot-shared/ethereum'
import { expect, test } from 'bun:test'
import { parseSecurityPoolScopes } from '../../src/state/security-pool-scopes.ts'

const scope = { address: '0x1111111111111111111111111111111111111111', universeId: '0', nextPositionId: '1', sweepEnd: '0' }
const blockHash: Hex = `0x${'11'.repeat(32)}`
test('#1632 durable scopes preserve the authenticated report cursor across restart', () => {
	expect(parseSecurityPoolScopes([{ ...scope, sponsoredReports: { nextBlock: '43', reportIds: ['7', '8'], blockHash } }])[0]?.sponsoredReports).toEqual({ nextBlock: 43n, reportIds: [7n, 8n], blockHash })
	for (const reportIds of [['0'], ['7', '7'], ['-1']]) expect(() => parseSecurityPoolScopes([{ ...scope, sponsoredReports: { nextBlock: '43', reportIds, blockHash } }])).toThrow('Invalid sponsored report')
	expect(() => parseSecurityPoolScopes([{ ...scope, sponsoredReports: { nextBlock: '43', reportIds: ['7'], blockHash: '0x' } }])).toThrow('block hash')
})
