import Inv48QuotePrefixPolicyCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.QuoteQueryClass
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

/-- A query classification independent of worlds, answers and row lookup.
Address comparisons use the actual encoded code address, not unbounded words.
Selector comparisons use the actual request bytes. -/
inductive Class (escrow : CallRequest) : Query → Prop where
  | resource (q) : Class escrow (.resource q)
  | create (w q) : Class escrow (.external w (.create q))
  | kind (w request) (different : request.kind ≠ escrow.kind) :
      Class escrow (.external w (.call request))
  | address (w request) (different : request.codeAddress ≠ escrow.codeAddress) :
      Class escrow (.external w (.call request))
  | selector (w request)
      (different : ABI.readSelector? (byteArrayToBytes request.calldata) ≠
        ABI.readSelector? (byteArrayToBytes escrow.calldata)) :
      Class escrow (.external w (.call request))

theorem different (c : Context) (s : State) (data : List Byte) (q : Query)
    (classified : Class (buildCallRequest c .call c.self data 0 none) q) :
    q ≠ Inv48.ObservedEscrowResponder.query c s data := by
  intro eq
  cases classified with
  | resource => cases eq
  | create => cases eq
  | kind w request h =>
    have requests := ExternalRequest.call.inj (Query.external.inj eq).2
    exact h (congrArg CallRequest.kind requests)
  | address w request h =>
    have requests := ExternalRequest.call.inj (Query.external.inj eq).2
    exact h (congrArg CallRequest.codeAddress requests)
  | selector w request h =>
    have requests := ExternalRequest.call.inj (Query.external.inj eq).2
    exact h (congrArg (fun req : CallRequest =>
      ABI.readSelector? (byteArrayToBytes req.calldata)) requests)

theorem staticcall (c escrowContext : Context) (s : State) (target : Nat)
    (data escrowData : List Byte) (value : Nat) (gas : Option Nat) :
    Class (buildCallRequest escrowContext .call escrowContext.self escrowData 0 none)
      (.external (snapshotWorld c s) (.call (buildCallRequest c .staticcall target data value gas))) := by
  apply Class.kind
  simp [buildCallRequest,lowLevelKindToCallKind]

/-- World snapshots need not agree: static-call kind already separates them. -/
theorem staticcallDifferent (c escrowContext : Context) (s escrowState : State) (target : Nat)
    (data escrowData : List Byte) (value : Nat) (gas : Option Nat) :
    Query.external (snapshotWorld c s) (.call (buildCallRequest c .staticcall target data value gas)) ≠
      Inv48.ObservedEscrowResponder.query escrowContext escrowState escrowData :=
  different _ _ _ _ (staticcall c escrowContext s target data escrowData value gas)

#print axioms different
#print axioms staticcall
#print axioms staticcallDifferent
end Inv48.QuoteQueryClass
