import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeFunctionData, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_QuestionLedger_QuestionLedger as ledgerArtifact } from '../../types/contractArtifact'
import { useSecurityPoolFixture } from './securityPoolFixture'

const word = (value: bigint) => value.toString(16).padStart(64, '0')

// Exercise the real ledger dispatch boundary with a target returning arbitrary downstream
// failures. Code replacement isolates revert forwarding from the target's business logic.
describe('Statoblast: exact delegate failures (#1504)', () => {
	const fixture = useSecurityPoolFixture()
	const payloads: readonly Hex[] = [`0x08c379a0${encodeAbiParameters([{ type: 'string' }], ['Question active']).slice(2)}`, '0x', `0x4e487b71${word(0x11n)}`, '0xdeadbeef0102', '0x08c379a0', `0x08c379a0${word(2n ** 255n)}${word(0n)}`, `0x08c379a0${word(32n)}${word(1_000n)}`, `0x08c379a0${word(33n)}${word(0n)}`]
	for (const payload of payloads) {
		test(`preserves ${payload || 'empty'} without a second decoder failure`, async () => {
			const client = fixture.owner()
			const address = fixture.poolFor(fixture.base.questionId).questionLedger
			const target = await client.readContract({ abi: ledgerArtifact.abi, address, functionName: 'accountingModule' })
			const length = ((payload.length - 2) / 2).toString(16).padStart(4, '0')
			const generic = encodeAbiParameters([{ type: 'string' }], ['Delegate call failed']).slice(2)
			const decoderOffset = (43 + (payload.length - 2) / 2 + 15).toString(16).padStart(4, '0')
			const decoderJump = (42 + (payload.length - 2) / 2).toString(16).padStart(4, '0')
			const genericLength = (generic.length / 2).toString(16).padStart(4, '0')
			// ADDRESS differs under delegatecall. A direct decoder call returns a generic
			// reason, so this also detects a forwarding path that invokes that decoder.
			const code: Hex = `0x3073${target.slice(2)}1461${decoderJump}5761${length}61002a60003961${length}6000fd${payload.slice(2)}5b61${genericLength}61${decoderOffset}60003961${genericLength}6000f3${generic}`
			await fixture.base.mockWindow.request({ method: 'anvil_setCode', params: [target, code] })
			const data = encodeFunctionData({ abi: ledgerArtifact.abi, functionName: 'burnEscalationWinnerHaircut', args: [0n] })
			await expect(fixture.base.mockWindow.request({ method: 'eth_call', params: [{ to: address, data }, 'latest'] })).rejects.toMatchObject({ data: payload })
		})
	}
})
