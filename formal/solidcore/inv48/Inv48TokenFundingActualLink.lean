import Inv48TokenFundingActualCore
import SolidCore.Solidity.AdoptionLaws
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace Inv48.TokenFunding
open Inv39
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000

/-- An accepted responder answer exposes its actual source execution, not an
assumed Boolean or post-state delta. -/
theorem answerTokenSound (token payer escrow amount : Nat) (world : Shared.OpenWorld)
    (request : CallRequest) (reply : CallResponse)
    (answered : answerToken token payer escrow amount world request = some reply) :
    ∃ post values,
      TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "transferFrom")
        (Child.callContext (addressToWord request.caller) token)
        (adoptWorld world (Child.callContext (addressToWord request.caller) token) State.empty)
        [.word payer,.word escrow,.word amount] = some (.returned post values) ∧
      tokenReply world (addressToWord request.caller) token post values = some reply := by
  unfold answerToken at answered
  split at answered
  · cases answered
  · dsimp only at answered
    split at answered
    · rename_i post values actual
      exact ⟨post, values, actual, answered⟩
    · cases answered

/-- Successful accepted token replies entail funding from the entry ledger.
Enough balance is a conclusion, not a premise. -/
theorem acceptedFunding (token payer escrow amount : Nat) (world : Shared.OpenWorld)
    (request : CallRequest) (reply : CallResponse)
    (A : Nat → Prop) (b : Balances)
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
    (answered : answerToken token payer escrow amount world request = some reply) :
    ∃ post values,
      tokenReply world (addressToWord request.caller) token post values = some reply ∧
      amount≤balance payer b ∧ Books A post (move payer escrow amount b) ∧
      post.loadSlot (balanceSlot payer) =
        (if payer=escrow then balance payer b else balance payer b-amount) ∧
      post.loadSlot (balanceSlot escrow) =
        (if payer=escrow then balance escrow b else balance escrow b+amount) := by
  obtain ⟨post, values, actual, derived⟩ := answerTokenSound token payer escrow amount world request reply answered
  obtain ⟨enough, books, cap⟩ := Allowance.actualTransferFrom _ post A b payer escrow
    (addressToWord request.caller) token amount values pw ew cw amountFit P E oldFit separate sep book fit actual
  have delta := deltas A _ post b payer escrow amount P E book books enough
  rw [book.balances payer P, book.balances escrow E] at delta
  exact ⟨post, values, derived, enough, books, delta⟩
theorem tokenSelector : (model.core.findFunctionBySelector? 599290589).any
    (fun f => f.name == "transferFrom") = true := by native_decide

/-- The world retains every other account exactly, not merely created markers. -/
theorem accountsOverlay (world : Shared.OpenWorld) (caller token : Nat) (post : State) :
    (postWorld world caller token post).accounts = world.accounts.insert (wordToAddress token)
      (snapshotSelfAccount (Child.callContext caller token)
        { post with envWorld? := some world, worldMutatedSinceAdoption := true }) := rfl
/-- Balance reads after adopting the returned world are the actual token
post-state reads, up to the interpreter's word normalization. WF is a storage
representation premise, not an assumed balance change. -/
theorem worldSlot (world : Shared.OpenWorld) (caller token : Nat) (post : State)
    (storageWF : StorageMap.WF post.storage) (transientWF : StorageMap.WF post.transient)
    (key : Nat) :
    (adoptWorld (postWorld world caller token post) (Child.callContext caller token) State.empty).loadSlot key =
      Shared.norm (post.loadSlot key) := by
  let framed := { post with envWorld? := some world, worldMutatedSinceAdoption := true }
  have h := (adoptWorld_echo_noop (Child.callContext caller token) framed (.inr rfl)
    storageWF transientWF).1 key
  simpa [framed, postWorld, adoptWorld, State.loadSlot] using h
end Inv48.TokenFunding
