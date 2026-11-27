import Inv48OperationsPublicEntrySource
import Inv48BatchLoopClosureDecode
import Inv48WrapperTraversalRaw
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.WrapperTraversal
namespace Inv48.OperationsPublicEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
abbrev ValidationPlan := TargetPlan Inv48.Source.model.core.table Inv48.OperationsWrapperArgs.loopP.value

theorem splitAt {α : Type} (xs : List α) (k : Nat) (x : α) (get : xs[k]? = some x) :
    xs = xs.take k ++ x :: xs.drop (k+1) := by
  induction xs generalizing k with
  | nil => simp at get
  | cons head tail ih =>
    cases k with
    | zero => simp at get; subst head; rfl
    | succ k =>
      simp only [List.getElem?_cons_succ] at get
      simpa only [List.take_succ_cons,List.drop_succ_cons,List.cons_append] using
        congrArg (List.cons head) (ih k get)

theorem actualValidationPlan (fn : FunctionDef)
    (found : Inv48.OperationsWrapperArgs.wrapper = some fn) : Nonempty (ValidationPlan fn.body) := by
  have loop := (Inv48.OperationsWrapperArgs.actualNodes fn found).1
  have safe := checkedPrefixes
  simp only [prefixesCheck,found,Option.any_some,Bool.and_eq_true] at safe
  cases body : fn.body <;> try {simp [Inv48.OperationsWrapperArgs.mainStatements,body] at loop}
  case block outer =>
    cases middle : outer[5]? with
    | none => simp [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at loop
    | some stmt =>
      cases stmt <;> try {simp [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at loop}
      case block inner =>
        simp only [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at loop
        have outerSafe := safe.1
        have innerSafe := safe.2
        simp only [outerStatements,body] at outerSafe
        simp only [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at innerSafe
        have outerShape := splitAt outer 5 (.block inner) middle
        have innerShape := splitAt inner 4 Inv48.OperationsWrapperArgs.loopP.value loop
        let innerPlan : ValidationPlan (.block inner) := by
          have literal : ValidationPlan (.block (inner.take 4 ++
              Inv48.OperationsWrapperArgs.loopP.value :: inner.drop 5)) :=
            ⟨1,fun n => .block n (inner.take 4) _ (inner.drop 5) innerSafe (.here n),fun _ => rfl⟩
          exact (congrArg Stmt.block innerShape).symm ▸ literal
        have literal : ValidationPlan (.block (outer.take 5 ++ .block inner :: outer.drop 6)) :=
          ⟨innerPlan.depth+1,fun n => .block (n+innerPlan.depth) (outer.take 5) _
            (outer.drop 6) outerSafe (innerPlan.build n),innerPlan.leaf⟩
        exact ⟨(congrArg Stmt.block outerShape).symm ▸ literal⟩
end Inv48.OperationsPublicEntry
