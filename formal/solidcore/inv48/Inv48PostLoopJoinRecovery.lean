import Inv48PostLoopJoinContinuation
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
open Inv48.WrapperTraversal
namespace Inv48.PostLoopJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

private theorem bp {α : Type} (tree : SolI α) : tree >>= pure = tree := Interaction.bind_pure tree

def enclosing (n : Nat) (c : Context) (ys zs : List Stmt) (v : Result) : SolI Result :=
  ((listNext n Inv48.Source.model.core.table c (suffix++ys) v >>= pop) >>=
    listNext (n+1) Inv48.Source.model.core.table c zs) >>= pop

theorem enclosingRejects (n : Nat) (c : Context) (ys zs : List Stmt) (out : Result)
    (ordinary : ¬ Escapes out) : Rejects (enclosing n c ys zs) out := by
  intro v bad tr exec
  cases v <;> try contradiction
  all_goals
    change Interaction.Executes (pure _) tr (.ok out) at exec
    cases exec
    exact ordinary trivial

/-- Expose the exact enclosing continuation of the validation Site, using
only the two certified block prefixes. The checked context is unchanged. -/
theorem validationSite (n : Nat) (c : Context) (r : Runtime)
    (xs us ys zs : List Stmt)
    (safeX : Inv48.WrapperTraversal.prefixes Inv48.Source.model.core.table xs = true)
    (safeU : Inv48.WrapperTraversal.prefixes Inv48.Source.model.core.table us = true)
    (tr : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+2) Inv48.Source.model.core.table c r
      (.block (xs ++ .block (us ++ Inv48.OperationsWrapperArgs.loopP.value :: (suffix++ys)) :: zs)))
      tr (.ok out)) :
    ∃ s : Site (Stmt.eval (n+2) Inv48.Source.model.core.table c r
      (.block (xs ++ .block (us ++ Inv48.OperationsWrapperArgs.loopP.value :: (suffix++ys)) :: zs)))
      Inv48.Source.model.core.table Inv48.OperationsWrapperArgs.loopP.value tr out,
      s.fuel = n ∧ s.context = c ∧ s.continuation = enclosing n c ys zs := by
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
      refine ⟨⟨n,c,ready,enclosing n c ys zs,t1++t2,last,?_,?_,?_⟩,rfl,rfl,rfl⟩
      · exact split1.trans ((congrArg (List.append t1) split2).trans (by simp only [List.append_assoc]; rfl))
      · unfold enclosing
        simpa only [cut,innerCut,blockCut,here,bp,pb,List.append_nil,assoc] using cut.reached
      · unfold enclosing
        simpa only [Follows,Inv48.WrapperTraversal.Blocks.route,bp,assoc] using follow.2

theorem publicChecked (base : Context) (self sender value : Nat) (data : List Byte) :
    (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data).checked = true := rfl

theorem publicSender (base : Context) (self sender value : Nat) (data : List Byte) :
    (ABI.Contract.callContextAtWithBase Inv48.Source.model.core base self sender value data).sender =
      SolidCore.Solidity.Shared.norm sender := rfl
end Inv48.PostLoopJoin
