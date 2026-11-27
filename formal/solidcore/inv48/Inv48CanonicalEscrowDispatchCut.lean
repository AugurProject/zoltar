import Inv48CanonicalEscrowDispatchCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CanonicalEscrowDispatch
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Same actual-cut bridge as the public coverage proof, now with no selected
context/state/data. All child inputs come from the leading request event. -/
theorem successfulCut (s : Schedule) (c : Context) (site : Runtime) (data : List Byte)
    (replyFuel : Nat) (next : Result → SolI Result)
    (trace : Interaction.Transcript) (out : Result)
    (openWorld : c.selfDispatch? = none)
    (recognized : recognizes s (buildCallRequest c .call c.self data 0 none))
    (run : Interaction.Executes
      ((selfDispatchCall c site.state .call c.self data 0 none >>=
        Inv48.RequestQuote.reply replyFuel Inv48.Source.model.core.table c site
          Inv48.RequestQuote.returns Inv48.RequestQuote.cleanups Inv48.RequestQuote.successBody) >>= next)
      trace (.ok out))
    (aligned : Inv48.ObservedEscrowResponder.Matches (policy s) trace)
    (reject : ∀ mid err rest, ¬ Interaction.Executes (next (.reverted mid err)) rest (.ok out)) :
    ∃ child, serve s (snapshotWorld c site.state)
        (buildCallRequest c .call c.self data 0 none) = some child ∧
      child.result.success = true ∧
      ∃ rest, trace = ⟨Inv48.ObservedEscrowResponder.query c site.state data,
        Inv48.NestedResponder.response s.environment
          (inputState s (snapshotWorld c site.state)) child.result⟩ :: rest := by
  have reassoc : Interaction.Executes
      (selfDispatchCall c site.state .call c.self data 0 none >>= fun response =>
        Inv48.RequestQuote.reply replyFuel Inv48.Source.model.core.table c site
          Inv48.RequestQuote.returns Inv48.RequestQuote.cleanups Inv48.RequestQuote.successBody response >>= next)
      trace (.ok out) := by simpa only [Inv48.RequestGuards.assoc] using run
  rw [Inv48.EscrowEntry.openDispatchRequest c site.state c.self data _ openWorld] at reassoc
  cases reassoc with
  | request answer tail =>
    have matched := aligned ⟨Inv48.ObservedEscrowResponder.query c site.state data,answer⟩ List.mem_cons_self
    obtain ⟨child,computed,response⟩ := atEvent s _ _ answer recognized matched
    subst answer
    refine ⟨child,computed,?_,_,rfl⟩
    cases success : child.result.success with
    | true => rfl
    | false =>
      have decoded : (decodeCallResponse (Inv48.NestedResponder.response s.environment
          (inputState s (snapshotWorld c site.state)) child.result)
          .call c.self data 0 none).success = false := by
        simp [decodeCallResponse,Inv48.NestedResponder.response,success]
      simp only [Inv48.RequestQuote.reply,decoded,Bool.false_eq_true,if_false] at tail
      exact False.elim (reject _ _ _ tail)

/-- Lift the bridge from a slice of the one original observation. No second
observation, replay under another policy, or child-success premise. -/
theorem observedCut {α : Type} (s : Schedule) (budget : Nat)
    (root : SolI α) (observed : Inv48.NestedResponder.Observation root)
    (computed : Inv48.ObservedEscrowResponder.observe budget (policy s) root = some observed)
    (before trace after : Interaction.Transcript)
    (split : observed.trace = before ++ trace ++ after)
    (c : Context) (site : Runtime) (data : List Byte)
    (replyFuel : Nat) (next : Result → SolI Result) (out : Result)
    (openWorld : c.selfDispatch? = none)
    (recognized : recognizes s (buildCallRequest c .call c.self data 0 none))
    (run : Interaction.Executes
      ((selfDispatchCall c site.state .call c.self data 0 none >>=
        Inv48.RequestQuote.reply replyFuel Inv48.Source.model.core.table c site
          Inv48.RequestQuote.returns Inv48.RequestQuote.cleanups Inv48.RequestQuote.successBody) >>= next)
      trace (.ok out))
    (reject : ∀ mid err rest, ¬ Interaction.Executes (next (.reverted mid err)) rest (.ok out)) :
    ∃ child, serve s (snapshotWorld c site.state)
        (buildCallRequest c .call c.self data 0 none) = some child ∧
      child.result.success = true ∧
      ∃ rest, trace = ⟨Inv48.ObservedEscrowResponder.query c site.state data,
        Inv48.NestedResponder.response s.environment
          (inputState s (snapshotWorld c site.state)) child.result⟩ :: rest := by
  apply successfulCut s c site data replyFuel next trace out openWorld recognized run
  · have aligned := Inv48.ObservedEscrowResponder.observedMatches budget _ root observed computed
    intro event member
    exact aligned event (by
      rw [split]
      exact List.mem_append_left after (List.mem_append_right before member))
  · exact reject

/-- Child transfer and token boundary for the computed wire input. The equality
here is ABI wire decoding, not selection of a policy suspension. -/
theorem transferOfWire (s : Schedule) (world : SolidCore.Solidity.Shared.OpenWorld)
    (request : CallRequest) (sponsor a p halt bounty gas : Nat)
    (wire : byteArrayToBytes request.calldata =
      Inv48.RequestQuote.calldata 2391489481 s.environment.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas)
    (child : Inv48.NestedResponder.Served s.environment (inputState s world)
      (byteArrayToBytes request.calldata) s.fuel s.childBudget s.childRows)
    (success : child.result.success = true) (sponsorFits : sponsor < 2^160) :
    ∃ canonical : Inv48.NestedResponder.Served s.environment (inputState s world)
      (Inv48.RequestQuote.calldata 2391489481 s.environment.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas) s.fuel s.childBudget s.childRows,
      canonical = wire ▸ child ∧ canonical.result = child.result ∧
      canonical.nested.observed.trace = child.nested.observed.trace ∧
      Inv48.SingleTransferClosed.Transfer canonical ∧
      Inv48.PublicTokenDelta.TransferBoundary canonical := by
  generalize h : byteArrayToBytes request.calldata = bytes at *
  cases wire
  exact ⟨child,rfl,rfl,rfl,Inv48.SingleTransferClosed.childTransferOfSuccess child success sponsorFits,
    Inv48.PublicTokenDelta.ofTransfer child
      (Inv48.SingleTransferClosed.childTransferOfSuccess child success sponsorFits)⟩
end Inv48.CanonicalEscrowDispatch
