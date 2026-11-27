import Inv48PreLoopJoinRaw
import Inv48PostLoopJoinBody
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
open Inv48.WrapperTraversal
open Inv48.PostLoopJoin
namespace Inv48.OperationsRawJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
private theorem bp {α : Type} (tree : SolI α) : tree >>= pure = tree := Interaction.bind_pure tree

/-- Input transport uses the same two prefix executions that construct the site. -/
theorem validationSiteInputs (n : Nat) (c : Context) (r : Runtime)
    (xs us ys zs : List Stmt)
    (safeX : Inv48.WrapperTraversal.prefixes Inv48.Source.model.core.table xs = true)
    (safeU : Inv48.WrapperTraversal.prefixes Inv48.Source.model.core.table us = true)
    (P Q : Runtime → Prop) (initial : P r)
    (outer : ∀ mid t, P r → Interaction.Executes (Stmt.evalList (n+1) Inv48.Source.model.core.table c r.pushScope xs) t (.ok (.normal mid)) → P mid)
    (transportInner : ∀ mid ready t, P mid → Interaction.Executes (Stmt.evalList n Inv48.Source.model.core.table c mid.pushScope us) t (.ok (.normal ready)) → Q ready)
    (tr : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+2) Inv48.Source.model.core.table c r
      (.block (xs ++ .block (us ++ Inv48.OperationsWrapperArgs.loopP.value :: (suffix++ys)) :: zs)))
      tr (.ok out)) :
    ∃ s : Site (Stmt.eval (n+2) Inv48.Source.model.core.table c r
      (.block (xs ++ .block (us ++ Inv48.OperationsWrapperArgs.loopP.value :: (suffix++ys)) :: zs)))
      Inv48.Source.model.core.table Inv48.OperationsWrapperArgs.loopP.value tr out,
      s.fuel = n ∧ s.context = c ∧ s.continuation = enclosing n c ys zs ∧ Q s.runtime := by
  let inner := Blocks.block n us Inv48.OperationsWrapperArgs.loopP.value (suffix++ys) safeU (.here n)
  let blocks := Blocks.block (n+1) xs _ zs safeX inner
  have rej : Rejects pure out := by
    intro v bad trace ex
    cases ex
    exact ordinary bad
  have follow := Inv48.WrapperTraversal.follows blocks c r pure tr out (fun rt err rest ex => rej (.reverted rt err) trivial rest ex)
    (by simpa only [bp] using run)
  change ∃ v before after, tr = before++after ∧ _ ∧ _ at follow
  obtain ⟨v,t1,after,split1,first,follow⟩ := follow
  cases v <;> try { exact False.elim (Bool.noConfusion follow.1) }
  case normal mid =>
    change ∃ v before rest, after = before++rest ∧ _ ∧ _ at follow
    obtain ⟨v,t2,last,split2,second,follow⟩ := follow
    cases v <;> try { exact False.elim (Bool.noConfusion follow.1) }
    case normal ready =>
      let innerCut := blockCut n Inv48.Source.model.core.table c mid ready us
        Inv48.OperationsWrapperArgs.loopP.value (suffix++ys) t2 second
        (here n Inv48.Source.model.core.table c ready Inv48.OperationsWrapperArgs.loopP.value)
      let cut := blockCut (n+1) Inv48.Source.model.core.table c r mid xs _ zs t1 first innerCut
      refine ⟨⟨n,c,ready,enclosing n c ys zs,t1++t2,last,?_,?_,?_⟩,rfl,rfl,rfl,transportInner mid ready t2 (outer mid t1 initial first) second⟩
      · exact split1.trans ((congrArg (List.append t1) split2).trans (by simp only [List.append_assoc]; rfl))
      · unfold enclosing
        simpa only [cut,innerCut,blockCut,here,bp,pb,List.append_nil,assoc] using cut.reached
      · unfold enclosing
        simpa only [Follows,Inv48.WrapperTraversal.Blocks.route,bp,assoc] using follow.2

end Inv48.OperationsRawJoin
