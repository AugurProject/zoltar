import Inv48CollateralReturnedMinimumCaller
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CollateralReturnedMinimum
open Inv48.CollateralCloneStage Inv48.Minima
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- End-to-end collateral return certificate for a recovered public execution.
All slices, snapshots, fuels and continuations are recovered from that execution. -/
def Certificate (s : Joined trace out) (d : Deployment s.context s.caller)
    (b : BaseDeployment s) : Prop :=
  ∃ response x,
    Inv48.MinimumSuccessWords.OracleEvent s.context s.start d.root (bytes d) s.during response ∧
    response.success = true ∧ x < Inv32Division.R ∧
    Inv48.ExposureComparison.decoded response x ∧
    b.base+Inv03.ceilQuot x 100 < Inv32Division.R ∧
    s.sourceValue = .returned (tailState s.tailStart x b.base)
      [.word (b.base+Inv03.ceilQuot x 100)] ∧
    ({ (tailState s.tailStart x b.base).popScope.popScope.popScope with
      locals := s.collateralSaved }).assignNamedValuesRef? [Inv48.Positive.ret1]
      [.word (b.base+Inv03.ceilQuot x 100)] = some s.publicFinal ∧
    s.sourceTail = [] ∧ s.collateralFinish = []

theorem certificate (s : Joined trace out) (d : Deployment s.context s.caller)
    (b : BaseDeployment s)
    (env : Inv48.MinimumSuccessWords.CanonicalOracle s.context s.start d.root (bytes d) s.during) :
    Certificate s d b := by
  obtain ⟨response,x,rest,event,success,fit,decoded,X⟩ :=
    Inv48.CollateralCloneFuel.closeSlice s.toSlice d env
  have returned := returnedMinimum s b x fit X
  have caller := callerAssignment s b x fit X
  exact ⟨response,x,⟨rest,event⟩,success,fit,decoded,returned.1,returned.2.1,
    caller.1,returned.2.2,caller.2⟩

/-- Raw successful public ABI execution supplies the recovered collateral
helper and caller assignment; no independently executed intermediate tail is
accepted. Deployment premises refer only to the recovered actual snapshots. -/
theorem fromRaw (n : Nat) (base : Context) (state : State)
    (self sender : Nat) (data : List Byte) (p : Nat)
    (read : ABI.readSelector? data = some 4197127132)
    (selected : Inv48.Source.model.core.findFunctionBySelector? 4197127132 = some Inv48.PositiveABI.entry)
    (decoded : ABI.decodeFunctionArgs? Inv48.PositiveABI.entry (data.drop ABI.selectorBytes) = .ok [.word p])
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext (n+5) Inv48.Source.model.core
      base state self sender 0 data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) (success : out.success = true) :
    let c := ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender 0 data
    let r := Inv48.Positive.start (Inv48.Positive.entryBase c state) p
    0 < p ∧ ∃ result, Inv48.RequestDispatch.finish Inv48.Source.model.core Inv48.PositiveABI.entry state result = .ok out ∧
      ∃ s : Joined trace result,
        ∀ (d : Deployment s.context s.caller) (b : BaseDeployment s),
          Inv48.MinimumSuccessWords.CanonicalOracle s.context s.start d.root (bytes d) s.during →
            Certificate s d b := by
  obtain ⟨positive,result,done,recovered⟩ := Inv48.MinimumCollateralTrace.rawCollateralList
    n base state self sender data p read selected decoded raw trace out linked run success
  obtain ⟨s⟩ := recover _ _ _ _ _ recovered
  exact ⟨positive,result,done,s,fun d b env => certificate s d b env⟩
end Inv48.CollateralReturnedMinimum
