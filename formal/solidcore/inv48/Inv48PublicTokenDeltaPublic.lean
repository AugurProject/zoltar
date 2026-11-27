import Inv48PublicTokenBoundaryCore
import Inv48SingleTransferClosedCore
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace Inv48.PublicTokenDelta
open Inv39 Inv48.EscrowPrefix Inv48.EscrowJoin Inv48.EscrowEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000

def Boundary (c : Context) (payer amount token : Nat) (trace : Interaction.Transcript) : Prop :=
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
        reply.postWorld.createdAccounts = world.createdAccounts

def TransferBoundary {fuel budget : Nat} {rows : ScriptedResponder} {parent : Context} {state : State}
    {sponsor a p halt bounty gas : Nat}
    (served : Inv48.NestedResponder.Served parent state
      (Inv48.RequestQuote.calldata 2391489481 parent.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas) fuel budget rows) : Prop :=
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
    (Canonical c parent.sender (Inv03.ceilQuot (a*p) (10^18))
      (Inv48.CloneRead.decode token) served.nested.observed.trace →
    Boundary c parent.sender (Inv03.ceilQuot (a*p) (10^18))
      (Inv48.CloneRead.decode token) served.nested.observed.trace)

theorem ofTransfer {fuel budget : Nat} {rows : ScriptedResponder} {parent : Context} {state : State}
    {sponsor a p halt bounty gas : Nat}
    (served : Inv48.NestedResponder.Served parent state
      (Inv48.RequestQuote.calldata 2391489481 parent.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas) fuel budget rows)
    (transfer : Inv48.SingleTransferClosed.Transfer served) : TransferBoundary served := by
  intro k fuelEq c oracle collateral hw ha hh hb hg hp notConstruction
    implementation universeBytes token hi hu ht cu ct code O C
  obtain ⟨self, contains⟩ := transfer k fuelEq oracle collateral hw ha hh hb hg hp
    notConstruction implementation universeBytes token hi hu ht cu ct code O C
  exact ⟨self, fun canonical => boundary c _ _ _ _ contains canonical⟩

/-- Direct adapter for the successful served child recovered by raw Funding. -/
theorem ofSuccessfulChild {fuel budget : Nat} {rows : ScriptedResponder} {parent : Context} {state : State}
    {sponsor a p halt bounty gas : Nat}
    (served : Inv48.NestedResponder.Served parent state
      (Inv48.RequestQuote.calldata 2391489481 parent.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas) fuel budget rows)
    (success : served.result.success = true) (sponsorFits : sponsor < 2^160) :
    TransferBoundary served :=
  ofTransfer served (Inv48.SingleTransferClosed.childTransferOfSuccess served success sponsorFits)

end Inv48.PublicTokenDelta
