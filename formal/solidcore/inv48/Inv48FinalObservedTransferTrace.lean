import Inv48FinalObservedTransferCut
import Inv48CanonicalEscrowDispatchWire
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.FinalObservedTransfer
open Inv48.EscrowPrefix Inv48.EscrowJoin Inv48.EscrowEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
def ActualTransfer (fuel : Nat) (parent : Context) (state : State)
    (sponsor a p halt bounty gas : Nat) (trace : Interaction.Transcript) : Prop :=
  ∀ (k : Nat), fuel = k+47 →
    let c := Inv48.PublicInvariant.childContext parent
      (Inv48.RequestQuote.calldata 2391489481 parent.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas)

  ∀ (oracle collateral : Nat)
    (_hw : a < 2^256) (_ha : (Inv48.QuoteExec.repAmount a p) < 2^256) (_hh : halt < 2^256)
    (_hb : bounty < 2^256) (_hg : gas < 2^32) (_hp : parent.sender < 2^160)
    (_notConstruction : c.construction = false)
    (implementation universeBytes token : List Nat)
    (_hi : implementation.length=20) (_hu : universeBytes.length=31) (_ht : token.length=20)
    (_cu : ∀ b∈universeBytes,b<256) (_ct : ∀ b∈token,b<256)
    (_code : (lookupCaller (entry c state parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas).pushScope).state.envAccountCode c c.self =
      Inv48.CloneRead.runtimeCode implementation universeBytes token)
    (_O : (Inv48.CloneGetters.tStart (Inv48.CloneGetters.post (lookupCaller (entry c state parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas).pushScope) (Inv48.CloneRead.runtimeCode implementation universeBytes token))).loadImmutableField c "openOracle" = .ok (.word oracle))
    (_C : (Inv48.CloneGetters.tStart (Inv48.CloneGetters.post (lookupCaller (entry c state parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas).pushScope) (Inv48.CloneRead.runtimeCode implementation universeBytes token))).loadImmutableField c "collateralToken" = .ok (.word collateral))
    ,
    c.sender = c.self ∧ Inv48.InitialTransfer.Contains c parent.sender
      (Inv03.ceilQuot (a*p) (10^18)) (Inv48.CloneRead.decode token) trace
def ActualTokenBoundary (fuel : Nat) (parent : Context) (state : State)
    (sponsor a p halt bounty gas : Nat) (trace : Interaction.Transcript) : Prop :=
  ∀ (k : Nat), fuel = k+47 →
    let c := Inv48.PublicInvariant.childContext parent
      (Inv48.RequestQuote.calldata 2391489481 parent.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas)

  ∀ (oracle collateral : Nat)
    (_hw : a < 2^256) (_ha : (Inv48.QuoteExec.repAmount a p) < 2^256) (_hh : halt < 2^256)
    (_hb : bounty < 2^256) (_hg : gas < 2^32) (_hp : parent.sender < 2^160)
    (_notConstruction : c.construction = false)
    (implementation universeBytes token : List Nat)
    (_hi : implementation.length=20) (_hu : universeBytes.length=31) (_ht : token.length=20)
    (_cu : ∀ b∈universeBytes,b<256) (_ct : ∀ b∈token,b<256)
    (_code : (lookupCaller (entry c state parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas).pushScope).state.envAccountCode c c.self =
      Inv48.CloneRead.runtimeCode implementation universeBytes token)
    (_O : (Inv48.CloneGetters.tStart (Inv48.CloneGetters.post (lookupCaller (entry c state parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas).pushScope) (Inv48.CloneRead.runtimeCode implementation universeBytes token))).loadImmutableField c "openOracle" = .ok (.word oracle))
    (_C : (Inv48.CloneGetters.tStart (Inv48.CloneGetters.post (lookupCaller (entry c state parent.sender sponsor a (Inv48.QuoteExec.repAmount a p) halt bounty gas).pushScope) (Inv48.CloneRead.runtimeCode implementation universeBytes token))).loadImmutableField c "collateralToken" = .ok (.word collateral))
    ,
    c.sender = c.self ∧
    (Inv48.PublicTokenDelta.Canonical c parent.sender (Inv03.ceilQuot (a*p) (10^18))
      (Inv48.CloneRead.decode token) trace →
    Inv48.PublicTokenDelta.Boundary c parent.sender (Inv03.ceilQuot (a*p) (10^18))
      (Inv48.CloneRead.decode token) trace)

/-- Transport the rounded initial transfer and optional token-model boundary
onto the actual served wire child's transcript. The equality comes from
successfulCanonicalCut; the token model remains an explicit optional premise. -/
theorem actualChildTransfer {fuel budget : Nat} {rows : ScriptedResponder} {parent : Context} {state : State}
    {sponsor a p halt bounty gas : Nat}
    (canonical : Inv48.NestedResponder.Served parent state
      (Inv48.RequestQuote.calldata 2391489481 parent.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas) fuel budget rows)
    (actualTrace : Interaction.Transcript)
    (sameTrace : canonical.nested.observed.trace = actualTrace)
    (transfer : Inv48.SingleTransferClosed.Transfer canonical)
    (boundary : Inv48.PublicTokenDelta.TransferBoundary canonical) :
    ActualTransfer fuel parent state sponsor a p halt bounty gas actualTrace ∧
    ActualTokenBoundary fuel parent state sponsor a p halt bounty gas actualTrace := by
  subst actualTrace
  exact ⟨transfer,boundary⟩

#print axioms actualChildTransfer
end Inv48.FinalObservedTransfer
