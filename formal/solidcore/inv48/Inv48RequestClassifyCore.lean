import Inv48RequestDispatchPrologue
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch
namespace Inv48.RequestClassify
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

/-- A source-only route. It contains no runtime, responder, trace or execution
premise. Internal calls name the actual registered function. -/
inductive Route (table : FunctionTable) (target : Stmt) : Nat → Stmt → Type where
  | here (fuel) : Route table target fuel target
  | block (n) (xs : List Stmt) (child : Stmt) (ys : List Stmt)
      (inside : Route table target n child) :
      Route table target (n+1) (.block (xs++child::ys))
  | capture (n) (names : List String) (child : Stmt)
      (inside : Route table target n child) :
      Route table target (n+1) (.captureReturn names child)
  | call (n) (targets : List String) (key : String) (args : List Expr)
      (fn : InternalFunction) (found : table.lookup? key = some fn)
      (inside : Route table target n fn.body) :
      Route table target (n+1) (.internalCall targets key args)

/-- The complete selected-site continuation, including the caller's supplied
continuation. Both pieces of the original completed transcript are retained. -/
structure Site (root : SolI Result) (table : FunctionTable) (target : Stmt)
    (trace : Interaction.Transcript) (out : Result) where
  fuel : Nat
  context : Context
  runtime : Runtime
  continuation : Result → SolI Result
  before : Interaction.Transcript
  after : Interaction.Transcript
  split : trace = before++after
  reached : Prefix root before (Stmt.eval fuel table context runtime target >>= continuation)
  suffix : Interaction.Executes (Stmt.eval fuel table context runtime target >>= continuation) after (.ok out)

/-- An actual non-normal exit encountered before the selected site. This says
non-normal, not Solidity `return`: reverts and other control results are distinct. -/
structure Exit (root : SolI Result) (trace : Interaction.Transcript) (out : Result) where
  result : Result
  nonnormal : ∀ r, result ≠ .normal r
  continuation : Result → SolI Result
  before : Interaction.Transcript
  after : Interaction.Transcript
  split : trace = before++after
  reached : Prefix root before (continuation result)
  suffix : Interaction.Executes (continuation result) after (.ok out)

theorem classify (route : Route table target fuel stmt) (c : Context) (r : Runtime)
    (k : Result → SolI Result) (trace : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes (Stmt.eval fuel table c r stmt >>= k) trace (.ok out)) :
    Nonempty (Exit (Stmt.eval fuel table c r stmt >>= k) trace out) ∨
    Nonempty (Site (Stmt.eval fuel table c r stmt >>= k) table target trace out) := by
  induction route generalizing c r k trace out with
  | here fuel => exact .inr ⟨⟨fuel,c,r,k,[],trace,by simp, .refl _,run⟩⟩
  | block n xs child ys inside ih =>
    rw [blockSplit,assoc] at run
    obtain ⟨v,before,after,split,first,last⟩ := bindSuccess _ _ _ _ run
    cases v with
    | normal mid =>
      have childRun : Interaction.Executes
          (Stmt.eval n table c mid child >>= fun v => (listNext n table c ys v >>= pop) >>= k)
          after (.ok out) := by simpa only [assoc] using last
      rcases ih c mid (fun v => (listNext n table c ys v >>= pop) >>= k) after out childRun with early | reached
      · obtain ⟨e⟩ := early
        refine .inl ⟨⟨e.result,e.nonnormal,e.continuation,before++e.before,e.after,?_,?_,e.suffix⟩⟩
        · exact split.trans ((congrArg (fun t => before++t) e.split).trans (List.append_assoc _ _ _).symm)
        · rw [blockSplit,assoc]
          exact (Prefix.ofExecution first _).trans (by simpa only [assoc] using e.reached)
      · obtain ⟨s⟩ := reached
        refine .inr ⟨⟨s.fuel,s.context,s.runtime,s.continuation,before++s.before,s.after,?_,?_,s.suffix⟩⟩
        · exact split.trans ((congrArg (fun t => before++t) s.split).trans (List.append_assoc _ _ _).symm)
        · rw [blockSplit,assoc]
          exact (Prefix.ofExecution first _).trans (by simpa only [assoc] using s.reached)
    | returned mid values =>
      exact .inl ⟨⟨.returned mid values,by intros; simp,fun v => pop v >>= k,before,after,split,
        by rw [blockSplit,assoc]; exact Prefix.ofExecution first _,last⟩⟩
    | constructorReturned mid code =>
      exact .inl ⟨⟨.constructorReturned mid code,by intros; simp,fun v => pop v >>= k,before,after,split,
        by rw [blockSplit,assoc]; exact Prefix.ofExecution first _,last⟩⟩
    | selfdestructed mid =>
      exact .inl ⟨⟨.selfdestructed mid,by intros; simp,fun v => pop v >>= k,before,after,split,
        by rw [blockSplit,assoc]; exact Prefix.ofExecution first _,last⟩⟩
    | reverted mid err =>
      exact .inl ⟨⟨.reverted mid err,by intros; simp,fun v => pop v >>= k,before,after,split,
        by rw [blockSplit,assoc]; exact Prefix.ofExecution first _,last⟩⟩
    | broke mid =>
      exact .inl ⟨⟨.broke mid,by intros; simp,fun v => pop v >>= k,before,after,split,
        by rw [blockSplit,assoc]; exact Prefix.ofExecution first _,last⟩⟩
    | continued mid =>
      exact .inl ⟨⟨.continued mid,by intros; simp,fun v => pop v >>= k,before,after,split,
        by rw [blockSplit,assoc]; exact Prefix.ofExecution first _,last⟩⟩
  | capture n names child inside ih =>
    rw [Stmt.eval] at run
    change Interaction.Executes ((Stmt.eval n table c r child >>= captureNext names) >>= k) trace (.ok out) at run
    rw [assoc] at run
    rcases ih c r (fun v => captureNext names v >>= k) trace out run with early | reached
    · obtain ⟨e⟩ := early
      exact .inl ⟨⟨e.result,e.nonnormal,e.continuation,e.before,e.after,e.split,
        by simpa only [Stmt.eval,assoc] using e.reached,e.suffix⟩⟩
    · obtain ⟨s⟩ := reached
      exact .inr ⟨⟨s.fuel,s.context,s.runtime,s.continuation,s.before,s.after,s.split,
        by simpa only [Stmt.eval,assoc] using s.reached,s.suffix⟩⟩
  | call n targets key args fn found inside ih =>
    rw [Stmt.eval] at run
    change Interaction.Executes (((Expr.evalRefArgList c r args).caught >>=
      callNext n table c r targets key) >>= k) trace (.ok out) at run
    rw [assoc] at run
    obtain ⟨v,before,after,split,first,last⟩ := bindSuccess _ _ _ _ run
    cases v with
    | error err =>
      refine .inl ⟨⟨.reverted r err,by intros; simp,k,before,after,split,?_,?_⟩⟩
      · rw [Stmt.eval]
        change Prefix (((Expr.evalRefArgList c r args).caught >>= callNext n table c r targets key) >>= k) _ _
        rw [assoc]
        exact Prefix.ofExecution first _
      · exact last
    | ok pair =>
      obtain ⟨values,mid⟩ := pair
      cases entered : internalCallEnter? fn values mid with
      | none =>
        refine .inl ⟨⟨.reverted mid .typeMismatch,by intros; simp,k,before,after,split,?_,?_⟩⟩
        · rw [Stmt.eval]
          change Prefix (((Expr.evalRefArgList c r args).caught >>= callNext n table c r targets key) >>= k) _ _
          rw [assoc]
          have h := Prefix.ofExecution first (fun v => callNext n table c r targets key v >>= k)
          simpa only [callNext,found,entered] using h
        · simpa only [callNext,found,entered] using last
      | some pair =>
        obtain ⟨inner,saved⟩ := pair
        have innerRun : Interaction.Executes
            (Stmt.eval n table {c with checked := true} inner fn.body >>=
              fun v => internalCallFinish fn targets saved v >>= k) after (.ok out) := by
          simpa only [callNext,found,entered,assoc] using last
        rcases ih {c with checked := true} inner (fun v => internalCallFinish fn targets saved v >>= k)
            after out innerRun with early | reached
        · obtain ⟨e⟩ := early
          refine .inl ⟨⟨e.result,e.nonnormal,e.continuation,before++e.before,e.after,?_,?_,e.suffix⟩⟩
          · exact split.trans ((congrArg (fun t => before++t) e.split).trans (List.append_assoc _ _ _).symm)
          · rw [Stmt.eval]
            change Prefix (((Expr.evalRefArgList c r args).caught >>= callNext n table c r targets key) >>= k) _ _
            rw [assoc]
            apply (Prefix.ofExecution first _).trans
            simpa only [callNext,found,entered,assoc] using e.reached
        · obtain ⟨s⟩ := reached
          refine .inr ⟨⟨s.fuel,s.context,s.runtime,s.continuation,before++s.before,s.after,?_,?_,s.suffix⟩⟩
          · exact split.trans ((congrArg (fun t => before++t) s.split).trans (List.append_assoc _ _ _).symm)
          · rw [Stmt.eval]
            change Prefix (((Expr.evalRefArgList c r args).caught >>= callNext n table c r targets key) >>= k) _ _
            rw [assoc]
            apply (Prefix.ofExecution first _).trans
            simpa only [callNext,found,entered,assoc] using s.reached
end Inv48.RequestClassify
