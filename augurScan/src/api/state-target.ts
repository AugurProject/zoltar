import { ApiRequestError } from './shared.ts'

type Kind = 'pools' | 'questions' | 'universes'

export const validateStateIdentity = (kind: Kind, identity: string): void => {
	if (kind === 'pools' && !/^0x[0-9a-fA-F]{40}$/.test(identity)) throw new ApiRequestError('selectedIdentity must be a pool address')
	if ((kind === 'questions' || kind === 'universes') && !/^\d{1,78}$/.test(identity)) throw new ApiRequestError(`selectedIdentity must be a ${kind === 'questions' ? 'question' : 'universe'} ID`)
}
