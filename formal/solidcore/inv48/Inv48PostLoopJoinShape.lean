import Inv48PostLoopJoinRecovery
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.OperationsPublicEntry
namespace Inv48.PostLoopJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem sourceBlocks (fn : FunctionDef)
    (found : Inv48.OperationsWrapperArgs.wrapper = some fn) :
    ∃ xs us ys zs : List Stmt,
      fn.body = .block (xs ++ .block (us ++ Inv48.OperationsWrapperArgs.loopP.value :: (suffix ++ ys)) :: zs) ∧
      Inv48.WrapperTraversal.prefixes Inv48.Source.model.core.table xs = true ∧
      Inv48.WrapperTraversal.prefixes Inv48.Source.model.core.table us = true := by
  have loop := (Inv48.OperationsWrapperArgs.actualNodes fn found).1
  have safe := checkedPrefixes
  simp only [prefixesCheck,found,Option.any_some,Bool.and_eq_true] at safe
  have tail := sourceSuffix fn found
  cases body : fn.body <;> try {simp [Inv48.OperationsWrapperArgs.mainStatements,body] at loop}
  case block outer =>
    cases middle : outer[5]? with
    | none => simp [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at loop
    | some stmt =>
      cases stmt <;> try {simp [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at loop}
      case block inner =>
        simp only [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at loop tail
        have outerSafe := safe.1
        have innerSafe := safe.2
        simp only [outerStatements,body] at outerSafe
        simp only [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at innerSafe
        have outerShape := splitAt outer 5 (.block inner) middle
        have innerShape := splitAt inner 4 Inv48.OperationsWrapperArgs.loopP.value loop
        have suffixShape : inner.drop 5 = suffix ++ inner.drop 13 := by
          have h := List.take_append_drop 8 (inner.drop 5)
          rw [tail,List.drop_drop] at h
          exact h.symm
        refine ⟨outer.take 5,inner.take 4,inner.drop 13,outer.drop 6,?_,outerSafe,innerSafe⟩
        have innerEq : Stmt.block inner = .block (inner.take 4 ++
            Inv48.OperationsWrapperArgs.loopP.value :: (suffix ++ inner.drop 13)) :=
          congrArg Stmt.block (innerShape.trans (by rw [suffixShape]))
        exact (congrArg Stmt.block outerShape).trans
          (congrArg (fun stmt => Stmt.block (outer.take 5 ++ stmt :: outer.drop 6)) innerEq)
end Inv48.PostLoopJoin
