import Inv48EscrowEntryReach
import Inv48EscrowEntryRequest
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowEntry
open Inv48.EscrowPrefix Inv48.EscrowJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

/-- The public suffix contains a successful CREATE followed by the genuine REP
transfer request tree, with the original public payer and amount. -/
def TransferWitness (n : Nat) (c : Context) (lookupState : State)
    (payer amount rep : Nat) (suffixTrace : Interaction.Transcript) : Prop :=
  ∃ (segmentTrace tailTrace : Interaction.Transcript) (ready : Runtime)
    (before after : Interaction.Transcript) (bytes : List Byte)
    (created : CreateResponse) (pullTrace : Interaction.Transcript),
    suffixTrace = segmentTrace ++ tailTrace ∧ segmentTrace = before ++ after ∧
    before = [⟨.external (snapshotWorld c lookupState)
      (.create (buildCreateRequest c "SharedPoolReportEscrow" bytes 0 none)),created⟩] ++ pullTrace ∧
    (decodeCreateResponse created "SharedPoolReportEscrow" bytes 0 none).success = true ∧
    ready.lookupLocal? "payer" = some (.word payer) ∧
    ready.lookupLocal? "repAmount" = some (.word amount) ∧
    ready.lookupLocal? "escrow" = some (.word (u256ToWord created.address)) ∧
    u256ToWord created.address < 2^160 ∧
    Stmt.eval (n+3) Inv48.Source.model.core.table c ready EscrowTrace.transferStmt =
      (selfDispatchCall c ready.state .call rep
        (EscrowTrace.calldata payer (u256ToWord created.address) amount) 0 none >>=
        EscrowTrace.transferReply (n+2) Inv48.Source.model.core.table c ready)

def OpenTransferWitness (n : Nat) (c : Context) (lookupState : State)
    (payer amount rep : Nat) (suffixTrace : Interaction.Transcript) : Prop :=
  ∃ (segmentTrace tailTrace : Interaction.Transcript) (ready : Runtime)
    (before after : Interaction.Transcript) (bytes : List Byte)
    (created : CreateResponse) (pullTrace : Interaction.Transcript),
    suffixTrace = segmentTrace ++ tailTrace ∧ segmentTrace = before ++ after ∧
    before = [⟨.external (snapshotWorld c lookupState)
      (.create (buildCreateRequest c "SharedPoolReportEscrow" bytes 0 none)),created⟩] ++ pullTrace ∧
    (decodeCreateResponse created "SharedPoolReportEscrow" bytes 0 none).success = true ∧
    ready.lookupLocal? "payer" = some (.word payer) ∧
    ready.lookupLocal? "repAmount" = some (.word amount) ∧
    ready.lookupLocal? "escrow" = some (.word (u256ToWord created.address)) ∧
    u256ToWord created.address < 2^160 ∧
    Stmt.eval (n+3) Inv48.Source.model.core.table c ready EscrowTrace.transferStmt =
      Interaction.request (.external (snapshotWorld c ready.state)
        (.call (buildCallRequest c .call rep
          (EscrowTrace.calldata payer (u256ToWord created.address) amount) 0 none)))
        (fun answer => EscrowTrace.transferReply (n+2) Inv48.Source.model.core.table c ready
          (decodeCallResponse answer .call rep
            (EscrowTrace.calldata payer (u256ToWord created.address) amount) 0 none,
            adoptWorld answer.postWorld c ready.state))

theorem transferWitnessOpen (n : Nat) (c : Context) (lookupState : State)
    (payer amount rep : Nat) (trace : Interaction.Transcript)
    (openWorld : c.selfDispatch? = none)
    (witness : TransferWitness n c lookupState payer amount rep trace) :
    OpenTransferWitness n c lookupState payer amount rep trace := by
  obtain ⟨segmentTrace,tailTrace,ready,before,after,bytes,created,pullTrace,
    joined,segment,creation,success,P,A,E,bound,tree⟩ := witness
  refine ⟨segmentTrace,tailTrace,ready,before,after,bytes,created,pullTrace,
    joined,segment,creation,success,P,A,E,bound,?_⟩
  rw [tree,openDispatchRequest c ready.state rep _ _ openWorld]

/-- Full generated public entry, ABI frame and cleanups, self guard, real framed
REP lookup response, constructor/pull and transfer join. Inputs contain no
pre-constructor or post-constructor local-binding assumptions. The explicit
lookup response is an execution of the ACTUAL generated getter body. -/
theorem publicEntryIntoTransfer (n : Nat) (c : Context) (state : State)
    (response final : Runtime) (payer sponsor weth amount halt bounty gas rep oracle collateral : Nat)
    (hw : weth < 2^256) (ha : amount < 2^256) (hh : halt < 2^256)
    (hb : bounty < 2^256) (hg : gas < 2^32) (hp : payer < 2^160) (hr : rep < 2^256)
    (self : c.sender = c.self) (selfBound : c.self < 2^256) (zeroValue : c.value = 0)
    (notConstruction : c.construction = false)
    (O : response.loadImmutableField c "openOracle" = .ok (.word oracle))
    (C : response.loadImmutableField c "collateralToken" = .ok (.word collateral))
    (lookupTrace suffixTrace : Interaction.Transcript)
    (lookup : LookupResponse n Inv48.Source.model.core.table c lookupFn
      (lookupCaller (entry c state payer sponsor weth amount halt bounty gas).pushScope)
      response rep lookupTrace)
    (suffix : ExecutesOK (Stmt.evalList (n+3) Inv48.Source.model.core.table c
      (publicPrepared c state response payer sponsor weth amount halt bounty gas rep)
      (EscrowTrace.actualStatements.drop 4)) suffixTrace (.normal final)) :
    (∃ tree, fn.evalBodyEntry (n+5) Inv48.Source.model.core.table c state
      (arguments payer sponsor weth amount halt bounty gas) = some tree ∧
      ExecutesOK tree (lookupTrace ++ suffixTrace) (.normal final.popScope.popScope)) ∧
    TransferWitness n c response.state payer amount rep suffixTrace := by
  constructor
  · exact publicEntryFromBody (n+5) c state payer sponsor weth amount halt bounty gas zeroValue
      _ _ (publicBodyFromLookup n c state response final payer sponsor weth amount halt bounty gas rep
        hw ha hh hb hg self selfBound lookupTrace suffixTrace lookup suffix)
  · have split : (EscrowTrace.actualStatements.drop 4).take 4 ++
        (EscrowTrace.actualStatements.drop 4).drop 4 = EscrowTrace.actualStatements.drop 4 :=
      List.take_append_drop 4 _
    rw [← split] at suffix
    obtain ⟨segmentEnd,segmentTrace,tailTrace,joined,segment,_⟩ :=
      appendNormal (n+3) _ c _ final _ _ suffixTrace suffix
    obtain ⟨ready,before,after,bytes,created,pullTrace,joinedSegment,creation,success,P,A,E,bound,tree⟩ :=
      publicPreparedIntoTransfer n c state response segmentEnd payer sponsor weth amount halt bounty gas rep
        oracle collateral O C hp ha hr notConstruction segmentTrace segment
    exact ⟨segmentTrace,tailTrace,ready,before,after,bytes,created,pullTrace,
      joined,joinedSegment,creation,success,P,A,E,bound,tree⟩

/-- Observed successful PUBLIC entry version. The self guard is inferred,
not assumed. The explicit response is the actual local getter execution on
its real callee frame, with no intermediate local bindings as premises. -/
theorem publicSuccessfulEntryIntoTransfer (n : Nat) (c : Context) (state : State)
    (response final : Runtime) (payer sponsor weth amount halt bounty gas rep oracle collateral : Nat)
    (hw : weth < 2^256) (ha : amount < 2^256) (hh : halt < 2^256)
    (hb : bounty < 2^256) (hg : gas < 2^32) (hp : payer < 2^160) (hr : rep < 2^256)
    (senderBound : c.sender < 2^256) (selfBound : c.self < 2^256) (zeroValue : c.value = 0)
    (notConstruction : c.construction = false)
    (O : response.loadImmutableField c "openOracle" = .ok (.word oracle))
    (C : response.loadImmutableField c "collateralToken" = .ok (.word collateral))
    (lookup : LookupResponse n Inv48.Source.model.core.table c lookupFn
      (lookupCaller (entry c state payer sponsor weth amount halt bounty gas).pushScope)
      response rep [])
    (tree : SolI Result) (trace : Interaction.Transcript)
    (binding : fn.evalBodyEntry (n+5) Inv48.Source.model.core.table c state
      (arguments payer sponsor weth amount halt bounty gas) = some tree)
    (run : ExecutesOK tree trace (.normal final)) :
    c.sender = c.self ∧ TransferWitness n c response.state payer amount rep trace := by
  obtain ⟨self,rawFinal,_,suffix⟩ := suffixFromSuccessfulEntry n c state response final
    payer sponsor weth amount halt bounty gas rep hw ha hh hb hg senderBound selfBound zeroValue
    lookup tree trace binding run
  have joined := publicEntryIntoTransfer n c state response rawFinal payer sponsor weth amount halt bounty gas rep
    oracle collateral hw ha hh hb hg hp hr self selfBound zeroValue notConstruction O C [] trace lookup suffix
  exact ⟨self,joined.2⟩

#print axioms transferWitnessOpen
#print axioms publicSuccessfulEntryIntoTransfer
#print axioms publicEntryIntoTransfer
end Inv48.EscrowEntry
