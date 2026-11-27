import Inv48PostLoopJoinSource
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify
namespace Inv48.PostLoopJoin
open Inv48.OperationsPublicEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

theorem normalHead (n : Nat) (c : Context) (r final : Runtime)
    (s : Stmt) (ss : List Stmt) (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.evalList n Inv48.Source.model.core.table c r (s::ss))
      tr (.ok (.normal final))) :
    ∃ mid first rest, tr = first ++ rest ∧
      Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r s) first (.ok (.normal mid)) ∧
      Interaction.Executes (Stmt.evalList n Inv48.Source.model.core.table c mid ss) rest (.ok (.normal final)) := by
  rw [Stmt.evalList] at run
  obtain ⟨v,first,rest,split,exec,last⟩ := bindSuccess _ _ _ _ run
  cases v <;> try { cases last }
  exact ⟨_,first,rest,split,exec,last⟩

theorem headReached (n : Nat) (c : Context) (r mid : Runtime)
    (s : Stmt) (ss : List Stmt) (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table c r s)
      tr (.ok (.normal mid))) :
    Prefix (Stmt.evalList n Inv48.Source.model.core.table c r (s::ss)) tr
      (Stmt.evalList n Inv48.Source.model.core.table c mid ss) := by
  rw [Stmt.evalList]
  exact Prefix.ofExecution run _

def staged (r : Runtime) (g : Nat) : Runtime :=
  callbackStage (r.declareLocal "_sol_hoist_1" (.word g)) g

theorem stagedInputs (r : Runtime) (g p a b : Nat) (batch : Value)
    (inputs : Inv48.BatchInputLoop.Inputs r p a b batch) :
    Inv48.BatchInputLoop.Inputs (staged r g) p a b batch := by
  simpa [Inv48.BatchInputLoop.Inputs,staged,callbackStage] using inputs

/-- One successful suffix run supplies all local guard/hoist executions and
transports the original loop inputs to the actual request block. -/
theorem invert (n : Nat) (c : Context) (r final : Runtime)
    (checked : c.checked = true) (p a b : Nat) (batch : Value)
    (inputs : Inv48.BatchInputLoop.Inputs r p a b batch)
    (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.evalList (n+7) Inv48.Source.model.core.table c r suffix)
      tr (.ok (.normal final))) :
    ∃ needed supplied g budgetTrace gasTrace limitTrace rest,
      tr = budgetTrace ++ (gasTrace ++ (limitTrace ++ rest)) ∧
      needed < 2^256 ∧ supplied < 2^256 ∧ needed ≤ supplied ∧ g < 2^32 ∧
      Expr.evalFuel 7 c r (.castOp .uintCleanup 256 batchGas) = pure (.word supplied,r) ∧
      Expr.eval c r gasRead = pure (.word g,r) ∧
      4000000+g ≤ 10000000 ∧
      Prefix (Stmt.evalList (n+7) Inv48.Source.model.core.table c r suffix)
        (budgetTrace ++ (gasTrace ++ limitTrace))
        (Stmt.eval (n+7) Inv48.Source.model.core.table c
          ((staged r g).declareLocal "_sol_hoist_0" (.word 0))
          Inv48.OperationsWrapperArgs.requestP.value) ∧
      Inv48.BatchInputLoop.Inputs ((staged r g).declareLocal "_sol_hoist_0" (.word 0)) p a b batch ∧
      Interaction.Executes (Stmt.eval (n+7) Inv48.Source.model.core.table c
        ((staged r g).declareLocal "_sol_hoist_0" (.word 0))
        Inv48.OperationsWrapperArgs.requestP.value) rest (.ok (.normal final)) := by
  obtain ⟨r1,t1,t2,split1,budgetRun,tail⟩ := normalHead (n+7) c r final _ _ tr run
  obtain ⟨needed,supplied,L,R,hn,hs,le,same⟩ := budgetSatisfied (n+7) c r r1 t1 budgetRun
  subst r1
  obtain ⟨r2,t3,t4,split2,gasRun,tail⟩ := normalHead (n+7) c r final _ _ t2 tail
  obtain ⟨g,hg,read,shape⟩ := gasHoistExecution (n+7) c r r2 t3 gasRun
  subst r2
  have pref := callbackPrefixExecution (n+1) c (r.declareLocal "_sol_hoist_1" (.word g)) g checked hg (by simp)
  change Interaction.Executes (Stmt.evalList (n+7) _ c _ (callbackPrefix ++ _)) t4 _ at tail
  rw [Inv48.CloneGetters.seq_append _ _ _ _ _ _ _ pref] at tail
  obtain ⟨r3,t5,t6,split3,limitRun,tail⟩ := normalHead (n+7) c (staged r g) final _ _ t4 tail
  obtain ⟨limit,fit,same⟩ := callbackStageLimit (n+7) c _ r3 g hg t5 limitRun
  subst r3
  have decl := Inv48.CloneGetters.decl_none (n+6) Inv48.Source.model.core.table c (staged r g) .uint256 "_sol_hoist_0"
  simp only [Ty.defaultValue] at decl
  change Interaction.Executes (Stmt.evalList (n+7) _ c (staged r g) _) t6 _ at tail
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ decl,Inv48.WholeQuote.singleList] at tail
  have reach1 := headReached (n+7) c r r budgetGuard
    ([gasHoist] ++ callbackPrefix ++ [Inv48.OperationsWrapperArgs.limitP.value,
      .varDecl .uint256 "_sol_hoist_0" none,Inv48.OperationsWrapperArgs.requestP.value]) t1 budgetRun
  have reach2 := headReached (n+7) c r (r.declareLocal "_sol_hoist_1" (.word g)) gasHoist
    (callbackPrefix ++ [Inv48.OperationsWrapperArgs.limitP.value,
      .varDecl .uint256 "_sol_hoist_0" none,Inv48.OperationsWrapperArgs.requestP.value]) t3 gasRun
  rw [Inv48.CloneGetters.seq_append _ _ _ _ _ _ _ pref] at reach2
  have reach3 := headReached (n+7) c (staged r g) (staged r g)
    Inv48.OperationsWrapperArgs.limitP.value
    [.varDecl .uint256 "_sol_hoist_0" none,Inv48.OperationsWrapperArgs.requestP.value] t5 limitRun
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ decl,Inv48.WholeQuote.singleList] at reach3
  have reached := reach1.trans (reach2.trans reach3)
  refine ⟨needed,supplied,g,t1,t3,t5,t6,?_,hn,hs,le,hg,R,read,limit,reached,?_,tail⟩
  · rw [split1,split2,split3]
  · simpa [Inv48.BatchInputLoop.Inputs] using stagedInputs r g p a b batch inputs
end Inv48.PostLoopJoin
