import type { PositionTicket } from '../../features/LivePositionControls.js'

/** An idle trade ticket with inert actions; tests override only the inputs they exercise. */
export function positionTicket(overrides: Partial<PositionTicket> = {}): PositionTicket {
	return {
		mode: 'entry',
		side: 'YES',
		amount: '',
		impactAcknowledged: false,
		state: 'idle',
		positionHash: undefined,
		message: undefined,
		positionReceiptWarning: undefined,
		setMode: () => undefined,
		setSide: () => undefined,
		setAmount: () => undefined,
		setImpactAcknowledged: () => undefined,
		submit: async () => undefined,
		...overrides,
	}
}
