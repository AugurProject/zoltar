import Inv48TokenFundingActualLink
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace Inv48.TokenFunding
open Inv39
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000

theorem replyWorld (world : Shared.OpenWorld) (caller token : Nat) (post : State)
    (values : List Value) (reply : CallResponse)
    (derived : tokenReply world caller token post values = some reply) :
    reply.postWorld = postWorld world caller token post ∧ reply.success = true := by
  unfold tokenReply at derived
  cases encoded : ABI.encodeValues? [.bool] values with
  | none => simp [encoded] at derived
  | some bytes =>
    simp only [encoded, bind, Option.bind, pure, Option.some.injEq] at derived
    cases derived
    exact ⟨rfl, rfl⟩

/-- Transport the derived INV39 ledger through the actual reply post-world.
This helper's Books premise is supplied by acceptedFunding, not assumed deltas. -/
theorem replyDeltas (world : Shared.OpenWorld) (caller token payer escrow amount : Nat)
    (post : State) (values : List Value) (reply : CallResponse) (A : Nat → Prop) (b : Balances)
    (P : A payer) (E : A escrow) (enough : amount≤balance payer b) (fit : total b<R)
    (books : Books A post (move payer escrow amount b))
    (storageWF : StorageMap.WF post.storage) (transientWF : StorageMap.WF post.transient)
    (derived : tokenReply world caller token post values = some reply) :
    let final := adoptWorld reply.postWorld (Child.callContext caller token) State.empty
    final.loadSlot (balanceSlot payer) =
      (if payer=escrow then balance payer b else balance payer b-amount) ∧
    final.loadSlot (balanceSlot escrow) =
      (if payer=escrow then balance escrow b else balance escrow b+amount) ∧
    reply.postWorld.createdAccounts = world.createdAccounts := by
  dsimp only
  rw [(replyWorld world caller token post values reply derived).1]
  rw [worldSlot world caller token post storageWF transientWF,
    worldSlot world caller token post storageWF transientWF,
    books.balances payer P, books.balances escrow E]
  have normP : Shared.norm (balance payer (move payer escrow amount b)) = balance payer (move payer escrow amount b) :=
    Nat.mod_eq_of_lt (lt_of_le_of_lt (balanceLE payer _) (by rw [movePreserves _ _ _ _ enough]; exact fit))
  have normE : Shared.norm (balance escrow (move payer escrow amount b)) = balance escrow (move payer escrow amount b) :=
    Nat.mod_eq_of_lt (lt_of_le_of_lt (balanceLE escrow _) (by rw [movePreserves _ _ _ _ enough]; exact fit))
  rw [normP, normE, preservesCreated]
  by_cases same : payer=escrow
  · subst escrow
    simp only [move, balanceSet, if_true]
    exact ⟨Nat.sub_add_cancel enough, Nat.sub_add_cancel enough, trivial⟩
  · simp [move, balanceSet, same, Ne.symm same]
/-- General end-to-end conditional result for the token responder: acceptance
of the exact generated request entails balance changes in the returned WORLD.
Neither sufficient balance nor balance deltas are hypotheses. -/
theorem fundedReply (token payer escrow amount : Nat) (world : Shared.OpenWorld)
    (request : CallRequest) (reply : CallResponse) (A : Nat → Prop) (b : Balances)
    (pw : payer<2^160) (ew : escrow<2^160)
    (cw : addressToWord request.caller<2^160) (amountFit : amount<R)
    (P : A payer) (E : A escrow)
    (oldFit : (adoptWorld world (Child.callContext (addressToWord request.caller) token) State.empty).loadSlot
      (Allowance.slot payer (addressToWord request.caller))<R)
    (separate : (adoptWorld world (Child.callContext (addressToWord request.caller) token) State.empty).loadSlot
      (Allowance.slot payer (addressToWord request.caller))<R-1 → Allowance.Separate A payer (addressToWord request.caller))
    (sep : SlotSeparation A)
    (book : Books A (adoptWorld world (Child.callContext (addressToWord request.caller) token) State.empty) b)
    (fit : total b<R)
    (canonical : ∀ post values,
      TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "transferFrom")
        (Child.callContext (addressToWord request.caller) token)
        (adoptWorld world (Child.callContext (addressToWord request.caller) token) State.empty)
        [.word payer,.word escrow,.word amount] = some (.returned post values) →
      StorageMap.WF post.storage ∧ StorageMap.WF post.transient)
    (answered : answerToken token payer escrow amount world request = some reply) :
    let final := adoptWorld reply.postWorld (Child.callContext (addressToWord request.caller) token) State.empty
    amount≤balance payer b ∧
    final.loadSlot (balanceSlot payer) =
      (if payer=escrow then balance payer b else balance payer b-amount) ∧
    final.loadSlot (balanceSlot escrow) =
      (if payer=escrow then balance escrow b else balance escrow b+amount) ∧
    reply.postWorld.createdAccounts = world.createdAccounts := by
  obtain ⟨post, values, actual, derived⟩ := answerTokenSound token payer escrow amount world request reply answered
  obtain ⟨enough, books, _⟩ := Allowance.actualTransferFrom _ post A b payer escrow
    (addressToWord request.caller) token amount values pw ew cw amountFit P E oldFit separate sep book fit actual
  have wf := canonical post values actual
  exact ⟨enough, replyDeltas world (addressToWord request.caller) token payer escrow amount
    post values reply A b P E enough fit books wf.1 wf.2 derived⟩
end Inv48.TokenFunding
