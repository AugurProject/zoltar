import Inv48TokenFundingResult
import Inv48InitialTransferPublic
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace Inv48.PublicTokenDelta
open Inv39
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000

/-- An environment contract on the actual child trace. Only exact generated REP
requests are constrained. The world argument is the event's suspension snapshot.
Books, representation and address bounds are independent premises, never deltas. -/
def Canonical (c : Context) (payer amount token : Nat)
    (trace : Interaction.Transcript) : Prop :=
  ∀ (ready : Runtime) (escrow : Nat) (reply : CallResponse),
    (⟨.external (snapshotWorld c ready.state)
      (.call (buildCallRequest c .call token
        (Inv48.EscrowTrace.calldata payer escrow amount) 0 none)),reply⟩ : Interaction.Exchange) ∈ trace →
    let world := snapshotWorld c ready.state
    let request := buildCallRequest c .call token
      (Inv48.EscrowTrace.calldata payer escrow amount) 0 none
    Inv48.TokenFunding.answerToken token payer escrow amount world request = some reply ∧
    ∃ (A : Nat → Prop) (b : Balances),
      payer < 2^160 ∧ escrow < 2^160 ∧ addressToWord request.caller < 2^160 ∧ amount < R ∧
      A payer ∧ A escrow ∧
      (adoptWorld world (Child.callContext (addressToWord request.caller) token) State.empty).loadSlot
        (Allowance.slot payer (addressToWord request.caller)) < R ∧
      ((adoptWorld world (Child.callContext (addressToWord request.caller) token) State.empty).loadSlot
        (Allowance.slot payer (addressToWord request.caller)) < R-1 →
          Allowance.Separate A payer (addressToWord request.caller)) ∧
      SlotSeparation A ∧
      Books A (adoptWorld world (Child.callContext (addressToWord request.caller) token) State.empty) b ∧
      total b < R ∧
      (∀ post values,
        TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "transferFrom")
          (Child.callContext (addressToWord request.caller) token)
          (adoptWorld world (Child.callContext (addressToWord request.caller) token) State.empty)
          [.word payer,.word escrow,.word amount] = some (.returned post values) →
        StorageMap.WF post.storage ∧ StorageMap.WF post.transient)

/-- Ordered CREATE and the same token event, with actual source execution and
balance changes at its reply boundary. No statement about the later start call. -/
theorem boundary (c : Context) (payer amount token : Nat) (trace : Interaction.Transcript)
    (contains : Inv48.InitialTransfer.Contains c payer amount token trace)
    (canonical : Canonical c payer amount token trace) :
    ∃ (lookupState : State) (ready : Runtime) (bytes : List Source.Byte)
      (created : CreateResponse) (reply : CallResponse) (pullTrace rest : Interaction.Transcript),
      trace = [⟨.external (snapshotWorld c lookupState)
        (.create (buildCreateRequest c "SharedPoolReportEscrow" bytes 0 none)),created⟩] ++
        pullTrace ++ [⟨.external (snapshotWorld c ready.state)
          (.call (buildCallRequest c .call token
            (Inv48.EscrowTrace.calldata payer (u256ToWord created.address) amount) 0 none)),reply⟩] ++ rest ∧
      (decodeCreateResponse created "SharedPoolReportEscrow" bytes 0 none).success = true ∧
      u256ToWord created.address < 2^160 ∧
      let world := snapshotWorld c ready.state
      let request := buildCallRequest c .call token
        (Inv48.EscrowTrace.calldata payer (u256ToWord created.address) amount) 0 none
      ∃ (A : Nat → Prop) (b : Balances) (post : State) (values : List Value),
        Books A (adoptWorld world (Child.callContext (addressToWord request.caller) token) State.empty) b ∧
        TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "transferFrom")
          (Child.callContext (addressToWord request.caller) token)
          (adoptWorld world (Child.callContext (addressToWord request.caller) token) State.empty)
          [.word payer,.word (u256ToWord created.address),.word amount] = some (.returned post values) ∧
        Inv48.TokenFunding.tokenReply world (addressToWord request.caller) token post values = some reply ∧
        reply.success = true ∧ amount ≤ balance payer b ∧
        let final := adoptWorld reply.postWorld (Child.callContext (addressToWord request.caller) token) State.empty
        final.loadSlot (balanceSlot payer) =
          (if payer=u256ToWord created.address then balance payer b else balance payer b-amount) ∧
        final.loadSlot (balanceSlot (u256ToWord created.address)) =
          (if payer=u256ToWord created.address then balance (u256ToWord created.address) b
            else balance (u256ToWord created.address) b+amount) ∧
        reply.postWorld.createdAccounts = world.createdAccounts := by
  obtain ⟨lookupState,ready,bytes,created,reply,pullTrace,rest,split,success,bound⟩ := contains
  have member : (⟨.external (snapshotWorld c ready.state)
      (.call (buildCallRequest c .call token
        (Inv48.EscrowTrace.calldata payer (u256ToWord created.address) amount) 0 none)),reply⟩ : Interaction.Exchange) ∈ trace := by
    rw [split]
    simp only [List.mem_append, List.mem_singleton]
    exact Or.inl (Or.inr trivial)
  obtain ⟨answered,A,b,pw,ew,cw,af,P,E,old,separate,sep,book,fit,wf⟩ := canonical ready _ reply member
  obtain ⟨post,values,actual,derived⟩ := Inv48.TokenFunding.answerTokenSound _ _ _ _ _ _ _ answered
  have delta := Inv48.TokenFunding.fundedReply _ _ _ _ _ _ _ A b pw ew cw af P E old separate sep book fit wf answered
  exact ⟨lookupState,ready,bytes,created,reply,pullTrace,rest,split,success,bound,
    A,b,post,values,book,actual,derived,(Inv48.TokenFunding.replyWorld _ _ _ _ _ _ derived).2,delta⟩
end Inv48.PublicTokenDelta
