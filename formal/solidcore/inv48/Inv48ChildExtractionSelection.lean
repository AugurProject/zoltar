import Inv48PublicInvariantBoundaryCore
import Inv12NoEarlyExit
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv48.EscrowPrefix
namespace Inv48.ChildExtraction
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
private theorem findAgreement {α : Type} (fs : List α) (p q : α → Bool)
    (agree : fs.all (fun f => p f == q f) = true) : fs.find? p = fs.find? q := by
  induction fs with
  | nil => rfl
  | cons a rest ih =>
    simp only [List.all_cons,Bool.and_eq_true,beq_iff_eq] at agree
    simp only [List.find?_cons,agree.1]
    split
    · rfl
    · exact ih agree.2

/-- A Boolean certificate checks the predicates over the complete registered
function list; no equality instance for FunctionDef is assumed. -/
theorem selectorAgreement : Inv48.Source.model.core.functions.all
    (fun f => (match f.selector? with
      | some candidate => wordEq candidate 2391489481
      | none => false) == (f.name == "createReportEscrow")) = true := by native_decide

theorem selectorIdentity :
    Inv48.Source.model.core.findFunctionBySelector? 2391489481 =
      Inv48.Source.model.core.findFunctionByName? "createReportEscrow" :=
  findAgreement _ _ _ selectorAgreement

theorem selected : Inv48.Source.model.core.findFunctionBySelector? 2391489481 =
    some Inv48.EscrowEntry.fn := by
  rw [selectorIdentity, Inv48.EscrowEntry.found]

theorem safeSelected :
    (Inv48.Source.model.core.findFunctionBySelector? 2391489481).any
      (fun f => Inv12.fallsThrough 100 f.body) = true := by native_decide

theorem safe : Inv12.fallsThrough 100 Inv48.EscrowEntry.fn.body = true := by
  simpa only [selected,Option.any_some] using safeSelected

#print axioms selected
#print axioms safe
end Inv48.ChildExtraction
