import Inv48WrapperArgsCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.WrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
/-- A source certificate, separate from evaluated-value correspondence. -/
def sourceCheck := Inv48.FundingFallthrough.wrappers.all fun name =>
  (Inv48.Source.model.core.findFunctionByName? name).any fun fn =>
    (Inv48.WrapperTraversal.plan 100 Inv48.Source.model.core.table fn.body).any fun p =>
      callArgsP.test p.args

theorem checkedSource : sourceCheck = true := by native_decide

theorem plannedArgs (name : String) (wrapper : FunctionDef)
    (member : name ∈ Inv48.FundingFallthrough.wrappers)
    (registered : Inv48.Source.model.core.findFunctionByName? name = some wrapper)
    (p : Inv48.WrapperTraversal.Plan Inv48.Source.model.core.table wrapper.body)
    (found : Inv48.WrapperTraversal.plan 100 Inv48.Source.model.core.table wrapper.body = some p) :
    p.args = callArgs := by
  have h := List.all_eq_true.mp checkedSource name member
  simp only [registered,Option.any_some,found] at h
  exact callArgsP.sound _ h
end Inv48.WrapperArgs
