export async function commitSignerMutation<T>(candidate: T, rememberSigner: boolean, persist: (candidate: T) => Promise<void>, activate: (candidate: T) => void) {
	if (rememberSigner) await persist(candidate)
	activate(candidate)
}
