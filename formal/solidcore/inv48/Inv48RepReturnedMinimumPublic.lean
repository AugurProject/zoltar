import Inv48RepReturnedMinimumClose
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RepReturnedMinimum
open Inv48.MinimumSuccessWords
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def Certificate (s : Joined trace out) (d : Deployment s.context s.caller) : Prop :=
  ∃ response x,
    OracleEvent s.context s.start d.root (bytes d) s.during response ∧
    response.success = true ∧ x < Inv32Division.R ∧ Inv48.ExposureComparison.decoded response x ∧
    Inv03.ceilQuot x 100 < Inv32Division.R ∧
    s.value = .returned (tailState s.final x) [.word (Inv03.ceilQuot x 100)] ∧
    ({ (tailState s.final x).popScope.popScope.popScope with locals := s.saved }).assignNamedValuesRef?
      [Inv48.Positive.ret2] [.word (Inv03.ceilQuot x 100)] = some s.publicFinal ∧
    s.tail = [] ∧ s.finishTrace = []

theorem certificate (s : Joined trace out) (d : Deployment s.context s.caller)
    (env : CanonicalOracle s.context s.start d.root (bytes d) s.during) : Certificate s d := by
  obtain ⟨response,x,event,success,fit,decoded,X⟩ := closeRead s d env
  have returned := returnedMinimum s x fit X
  have caller := callerAssignment s x fit X
  exact ⟨response,x,event,success,fit,decoded,returned.2.2,returned.1,caller.1,returned.2.1,caller.2⟩

/-- Both helper witnesses belong to one actual public execution and result.
Deployment and oracle canonicality are indexed by recovered snapshots. Neither
helper success, decoded exposure, return formula nor original fuel bound is a premise. -/
theorem fromRaw (n : Nat) (base : Context) (state : State)
    (self sender : Nat) (data : List Source.Byte) (p : Nat)
    (read : ABI.readSelector? data = some 4197127132)
    (selected : Inv48.Source.model.core.findFunctionBySelector? 4197127132 = some Inv48.PositiveABI.entry)
    (decoded : ABI.decodeFunctionArgs? Inv48.PositiveABI.entry (data.drop ABI.selectorBytes) = .ok [.word p])
    (raw : SolI ABI.AbiCallResult) (trace : Interaction.Transcript) (out : ABI.AbiCallResult)
    (linked : ABI.Contract.callCalldataAtFromWithContext (n+5) Inv48.Source.model.core
      base state self sender 0 data = some raw)
    (run : Interaction.Executes raw trace (.ok out)) (success : out.success = true) :
    let c := ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender 0 data
    let r := Inv48.Positive.start (Inv48.Positive.entryBase c state) p
    0 < p ∧ ∃ result,
      Inv48.RequestDispatch.finish Inv48.Source.model.core Inv48.PositiveABI.entry state result = .ok out ∧
      Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c r Inv48.Public.body) trace (.ok result) ∧
      ∃ collateral : Inv48.CollateralReturnedMinimum.Joined trace result,
      ∃ rep : Joined trace result,
        (∀ (d : Inv48.CollateralCloneStage.Deployment collateral.context collateral.caller)
           (b : Inv48.CollateralReturnedMinimum.BaseDeployment collateral),
          CanonicalOracle collateral.context collateral.start d.root
            (Inv48.CollateralCloneStage.bytes d) collateral.during →
          Inv48.CollateralReturnedMinimum.Certificate collateral d b) ∧
        (∀ (d : Deployment rep.context rep.caller),
          CanonicalOracle rep.context rep.start d.root (bytes d) rep.during → Certificate rep d) := by
  obtain ⟨positive,result,done,body,collateral,rep⟩ := rawHelperBodies n base state self sender data p
    read selected decoded raw trace out linked run success
  obtain ⟨collateral⟩ := Inv48.CollateralReturnedMinimum.recover _ _ _ _ _
    (Inv48.MinimumCollateralTrace.completedList _ _ _ _ _ collateral)
  obtain ⟨rep⟩ := recover rep
  exact ⟨positive,result,done,body,collateral,rep,
    fun d b env => Inv48.CollateralReturnedMinimum.certificate collateral d b env,
    fun d env => certificate rep d env⟩
end Inv48.RepReturnedMinimum
