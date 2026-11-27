import Inv48NestedResponderCore
import Inv48EscrowTrace
import Inv39DelegateSuccess
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace Inv48.TokenFunding
open Inv39
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000

/-- Overlay the actual token state onto the world at the token suspension,
including the preceding CREATE. Only the token account and its logs are owned. -/
def postWorld (world : Shared.OpenWorld) (caller token : Nat) (post : State) :=
  snapshotWorld (Child.callContext caller token)
    { post with envWorld? := some world, worldMutatedSinceAdoption := true }

def tokenReply (world : Shared.OpenWorld) (caller token : Nat) (post : State)
    (values : List Value) : Option CallResponse := do
  let bytes ← ABI.encodeValues? [.bool] values
  pure {
    success := true
    returnData := bytesToByteArray bytes
    postWorld := postWorld world caller token post
    returnedGas := EvmYul.UInt256.ofNat 0 }

theorem preservesCreated (world : Shared.OpenWorld) (caller token : Nat) (post : State) :
    (postWorld world caller token post).createdAccounts = world.createdAccounts := rfl

/-- Both alias cases are explicit: a self-transfer has zero net funding. -/
theorem deltas (A : Nat → Prop) (s post : State) (b : Balances) (payer escrow amount : Nat)
    (P : A payer) (E : A escrow) (before : Books A s b)
    (after : Books A post (move payer escrow amount b)) (enough : amount ≤ balance payer b) :
    post.loadSlot (balanceSlot payer) =
      (if payer = escrow then s.loadSlot (balanceSlot payer) else s.loadSlot (balanceSlot payer)-amount) ∧
    post.loadSlot (balanceSlot escrow) =
      (if payer = escrow then s.loadSlot (balanceSlot escrow) else s.loadSlot (balanceSlot escrow)+amount) := by
  rw [after.balances payer P, after.balances escrow E,
    before.balances payer P, before.balances escrow E]
  by_cases same : payer = escrow
  · subst escrow
    simp only [move, balanceSet, if_true]
    exact ⟨Nat.sub_add_cancel enough, Nat.sub_add_cancel enough⟩
  · simp [move, balanceSet, same, Ne.symm same]

/-- General conditional funding theorem. No post-state or balance-delta premise:
INV39 supplies the actual source-lowered public transferFrom execution. -/
theorem funding (s : State) (A : Nat → Prop) (b : Balances)
    (payer escrow amount caller token old : Nat)
    (pw : payer<2^160) (ew : escrow<2^160) (cw : caller<2^160)
    (pn : payer≠0) (en : escrow≠0) (cn : old<R-1 → caller≠0)
    (P : A payer) (E : A escrow)
    (slot : s.loadSlot (Allowance.slot payer caller)=old) (oldFit : old<R)
    (allowed : old<R-1 → amount≤old)
    (separate : old<R-1 → Allowance.Separate A payer caller)
    (sep : SlotSeparation A) (book : Books A s b)
    (enough : amount≤balance payer b) (fit : total b<R) :
    ∃ post, TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "transferFrom")
      (Child.callContext caller token) s [.word payer,.word escrow,.word amount] =
        some (.returned post [.word 1]) ∧
      Books A post (move payer escrow amount b) ∧
      post.loadSlot (balanceSlot payer) =
        (if payer=escrow then s.loadSlot (balanceSlot payer) else s.loadSlot (balanceSlot payer)-amount) ∧
      post.loadSlot (balanceSlot escrow) =
        (if payer=escrow then s.loadSlot (balanceSlot escrow) else s.loadSlot (balanceSlot escrow)+amount) ∧
      post.loadSlot theoretical.slot=s.loadSlot theoretical.slot := by
  obtain ⟨post, actual, books, cap⟩ := Allowance.publicTransferFrom s A b payer escrow amount caller token old
    pw ew cw pn en cn P E slot oldFit allowed separate sep book enough fit
  exact ⟨post, actual, books, (deltas A s post b payer escrow amount P E book books enough).1,
    (deltas A s post b payer escrow amount P E book books enough).2, cap⟩

/-- Query matcher uses precisely the generated transfer calldata. No token
post-state is supplied by the caller: it is selected from actual execution. -/
def answerToken (token payer escrow amount : Nat) (world : Shared.OpenWorld)
    (request : CallRequest) : Option CallResponse := do
  if request.kind != .call || addressToWord request.codeAddress != token ||
      byteArrayToBytes request.calldata != Inv48.EscrowTrace.calldata payer escrow amount ||
      u256ToWord request.transferValue != 0 then none else do
    let caller := addressToWord request.caller
    let c := Child.callContext caller token
    let entry := adoptWorld world c State.empty
    match TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "transferFrom") c entry
        [.word payer,.word escrow,.word amount] with
    | some (.returned post values) => tokenReply world caller token post values
    | _ => none

end Inv48.TokenFunding
