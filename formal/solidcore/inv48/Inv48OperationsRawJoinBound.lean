import Inv48OperationsRawJoinSite
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
open Inv48.WrapperTraversal
open Inv48.PostLoopJoin Inv48.PreLoopJoin
namespace Inv48.OperationsRawJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Recover inputs, context, and the exact enclosing continuation together. -/
theorem boundSite (fn : FunctionDef) (found : Inv48.OperationsWrapperArgs.wrapper = some fn)
    (n : Nat) (p a b : Nat) (batch : Value)
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256)
    (c : Context) (r : Runtime) (initial : Inv48.BatchInputLoop.Inputs r p a b batch)
    (trace : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+2) Inv48.Source.model.core.table c r fn.body) trace (.ok out)) :
    ∃ s : Site (Stmt.eval (n+2) Inv48.Source.model.core.table c r fn.body)
        Inv48.Source.model.core.table Inv48.OperationsWrapperArgs.loopP.value trace out,
      s.fuel = n ∧ s.context = c ∧ Ready p a b batch s.runtime ∧
      ∃ ys zs, s.continuation = enclosing n c ys zs := by
  have loop := (Inv48.OperationsWrapperArgs.actualNodes fn found).1
  have safe := Inv48.OperationsPublicEntry.checkedPrefixes
  simp only [Inv48.OperationsPublicEntry.prefixesCheck,found,Option.any_some,Bool.and_eq_true] at safe
  obtain ⟨clean,init⟩ := actualPrefixes fn found
  cases body : fn.body <;> try {simp [Inv48.OperationsWrapperArgs.mainStatements,body] at loop}
  case block outer =>
    cases middle : outer[5]? with
    | none => simp [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at loop
    | some stmt =>
      cases stmt <;> try {simp [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at loop}
      case block inner =>
        simp only [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at loop init
        simp only [Inv48.OperationsPublicEntry.outerStatements,body] at clean
        have outerSafe := safe.1
        have innerSafe := safe.2
        simp only [Inv48.OperationsPublicEntry.outerStatements,body] at outerSafe
        simp only [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at innerSafe
        have outerShape := Inv48.OperationsPublicEntry.splitAt outer 5 (.block inner) middle
        have innerShape := Inv48.OperationsPublicEntry.splitAt inner 4 Inv48.OperationsWrapperArgs.loopP.value loop
        have tail := Inv48.PostLoopJoin.sourceSuffix fn found
        simp only [Inv48.OperationsWrapperArgs.mainStatements,body,middle] at tail
        have suffixShape : inner.drop 5 = Inv48.PostLoopJoin.suffix ++ inner.drop 13 := by
          have h := List.take_append_drop 8 (inner.drop 5)
          rw [tail,List.drop_drop] at h
          exact h.symm
        have shape : fn.body = .block (outer.take 5 ++ .block (inner.take 4 ++
            Inv48.OperationsWrapperArgs.loopP.value :: (Inv48.PostLoopJoin.suffix ++ inner.drop 13)) :: outer.drop 6) := by
          rw [body,← suffixShape,← innerShape,← outerShape]
        have shaped := run
        rw [shape] at shaped
        have recovered := validationSiteInputs n c r
          (outer.take 5) (inner.take 4) (inner.drop 13) (outer.drop 6) outerSafe innerSafe
          (fun r => Inv48.BatchInputLoop.Inputs r p a b batch) (Ready p a b batch) initial
          (by
            intro mid tr original exec
            rw [clean,cleanExecution n c r.pushScope p a b batch (pushInputs r p a b batch original) hp ha hb] at exec
            cases exec
            exact pushInputs r p a b batch original)
          (by
            intro mid ready tr inputs exec
            rw [init] at exec
            have eq := initialRuntime n c mid.pushScope ready tr exec
            rw [eq]
            exact readyInputs mid.pushScope p a b batch (pushInputs mid p a b batch inputs))
          trace out ordinary shaped
        rw [← shape,body] at recovered
        obtain ⟨s,fuel,context,continuation,ready⟩ := recovered
        exact ⟨s,fuel,context,ready,inner.drop 13,outer.drop 6,continuation⟩
end Inv48.OperationsRawJoin
