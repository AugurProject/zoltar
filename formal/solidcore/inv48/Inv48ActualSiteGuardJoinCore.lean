import Inv48ActualSiteGuardJoinSafety
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestClassify Inv48.RequestPrologue Inv48.GuardArgsFrame Inv48.RequestDispatch
namespace Inv48.ActualSiteGuardJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 400000
/-- Invert an actual successful block prefix, retaining its transcript slice and continuation. -/
theorem blockPrefix (n : Nat) (c : Context) (r : Runtime) (xs : List Stmt)
    (child : Stmt) (ys : List Stmt) (k : Result → SolI Result)
    (trace : Interaction.Transcript) (out : Result)
    (safe : Inv48.FundingFallthrough.prefixes Inv48.Source.model.core.table xs = true)
    (reject : ∀ mid err rest, ¬ Interaction.Executes (k (.reverted mid err)) rest (.ok out))
    (run : Interaction.Executes (Stmt.eval (n+1) Inv48.Source.model.core.table c r
      (.block (xs ++ child::ys)) >>= k) trace (.ok out)) :
    ∃ mid before after, trace = before++after ∧
      Interaction.Executes (Stmt.evalList n Inv48.Source.model.core.table c r.pushScope xs) before (.ok (.normal mid)) ∧
      Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c mid child >>=
        fun v => (listNext n Inv48.Source.model.core.table c ys v >>= pop) >>= k) after (.ok out) := by
  rw [blockSplit,assoc] at run
  obtain ⟨v,before,after,split,first,last⟩ := bindSuccess _ _ _ _ run
  rcases Inv48.FundingFallthrough.prefixOut _ xs safe n c r.pushScope before v first with ⟨mid,rfl⟩ | ⟨mid,err,rfl⟩
  · exact ⟨mid,before,after,split,first,by simpa only [assoc] using last⟩
  · exact False.elim (reject _ _ _ last)
end Inv48.ActualSiteGuardJoin
namespace Inv48.ActualSiteGuardJoin
 theorem listPrefix (n : Nat) (c : Context) (r : Runtime) (xs ys : List Stmt)
    (k : Result → SolI Result) (trace : Interaction.Transcript) (out : Result)
    (safe : Inv48.FundingFallthrough.prefixes Inv48.Source.model.core.table xs = true)
    (reject : ∀ mid err rest, ¬ Interaction.Executes (k (.reverted mid err)) rest (.ok out))
    (run : Interaction.Executes (Stmt.evalList n Inv48.Source.model.core.table c r (xs++ys) >>= k) trace (.ok out)) :
    ∃ mid before after, trace = before++after ∧
      Interaction.Executes (Stmt.evalList n Inv48.Source.model.core.table c r xs) before (.ok (.normal mid)) ∧
      Interaction.Executes (Stmt.evalList n Inv48.Source.model.core.table c mid ys >>= k) after (.ok out) := by
  rw [Inv48.WholeQuote.listAppend,assoc] at run
  obtain ⟨v,before,after,split,first,last⟩ := bindSuccess _ _ _ _ run
  rcases Inv48.FundingFallthrough.prefixOut _ xs safe n c r before v first with ⟨mid,rfl⟩ | ⟨mid,err,rfl⟩
  · exact ⟨mid,before,after,split,first,last⟩
  · exact False.elim (reject _ _ _ last)
end Inv48.ActualSiteGuardJoin
