import Inv48RequestClassifyCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch
namespace Inv48.RequestClassify
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

/-- An execution derivation along the source route. `false` means an actual
pre-site exit; `true` means the quote site is reached. Unlike a free existential
continuation, every frame and continuation is fixed by its source constructor. -/
inductive Traversal (table : FunctionTable) (target : Stmt) :
    {fuel : Nat} → {stmt : Stmt} → Route table target fuel stmt → Context → Runtime →
    (Result → SolI Result) → Interaction.Transcript → Result → Bool → Prop where
  | here (fuel) (c) (r) (k) (trace) (out)
      (run : Interaction.Executes (Stmt.eval fuel table c r target >>= k) trace (.ok out)) :
      Traversal table target (.here fuel) c r k trace out true
  | blockExit (n) (xs) (child) (ys) (inside : Route table target n child)
      (c) (r) (k) (before after) (out) (early)
      (nonnormal : ∀ mid, early ≠ .normal mid)
      (first : Interaction.Executes (Stmt.evalList n table c r.pushScope xs) before (.ok early))
      (last : Interaction.Executes (pop early >>= k) after (.ok out)) :
      Traversal table target (.block n xs child ys inside) c r k (before++after) out false
  | blockNext (n) (xs) (child) (ys) (inside : Route table target n child)
      (c) (r mid) (k) (before after) (out) (branch)
      (first : Interaction.Executes (Stmt.evalList n table c r.pushScope xs) before (.ok (.normal mid)))
      (next : Traversal table target inside c mid
        (fun v => (listNext n table c ys v >>= pop) >>= k) after out branch) :
      Traversal table target (.block n xs child ys inside) c r k (before++after) out branch
  | capture (n) (names) (child) (inside : Route table target n child)
      (c) (r) (k) (trace) (out) (branch)
      (next : Traversal table target inside c r (fun v => captureNext names v >>= k) trace out branch) :
      Traversal table target (.capture n names child inside) c r k trace out branch
  | callError (n) (targets) (key) (args) (fn) (found : table.lookup? key = some fn)
      (inside : Route table target n fn.body) (c) (r) (k) (before after) (out) (err)
      (first : Interaction.Executes (Expr.evalRefArgList c r args).caught before (.ok (.error err)))
      (last : Interaction.Executes (k (.reverted r err)) after (.ok out)) :
      Traversal table target (.call n targets key args fn found inside) c r k (before++after) out false
  | callRejected (n) (targets) (key) (args) (fn) (found : table.lookup? key = some fn)
      (inside : Route table target n fn.body) (c) (r mid) (k) (before after) (out) (values)
      (first : Interaction.Executes (Expr.evalRefArgList c r args).caught before (.ok (.ok (values,mid))))
      (entered : internalCallEnter? fn values mid = none)
      (last : Interaction.Executes (k (.reverted mid .typeMismatch)) after (.ok out)) :
      Traversal table target (.call n targets key args fn found inside) c r k (before++after) out false
  | callEntered (n) (targets) (key) (args) (fn) (found : table.lookup? key = some fn)
      (inside : Route table target n fn.body) (c) (r mid inner) (saved) (k) (before after) (out) (values) (branch)
      (first : Interaction.Executes (Expr.evalRefArgList c r args).caught before (.ok (.ok (values,mid))))
      (entered : internalCallEnter? fn values mid = some (inner,saved))
      (next : Traversal table target inside {c with checked := true} inner
        (fun v => internalCallFinish fn targets saved v >>= k) after out branch) :
      Traversal table target (.call n targets key args fn found inside) c r k (before++after) out branch

/-- Total on completed executions. No successful-prefix or computed search
premise occurs, even at internal entry. -/
theorem traversal (route : Route table target fuel stmt) (c : Context) (r : Runtime)
    (k : Result → SolI Result) (trace : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes (Stmt.eval fuel table c r stmt >>= k) trace (.ok out)) :
    ∃ branch, Traversal table target route c r k trace out branch := by
  induction route generalizing c r k trace out with
  | here fuel => exact ⟨true,.here fuel c r k trace out run⟩
  | block n xs child ys inside ih =>
    rw [blockSplit,assoc] at run
    obtain ⟨v,before,after,split,first,last⟩ := bindSuccess _ _ _ _ run
    subst trace
    cases v with
    | normal mid =>
      obtain ⟨branch,next⟩ := ih c mid (fun v => (listNext n table c ys v >>= pop) >>= k) after out
        (by simpa only [assoc] using last)
      exact ⟨branch,.blockNext n xs child ys inside c r mid k before after out branch first next⟩
    | returned mid values => exact ⟨false,.blockExit n xs child ys inside c r k before after out _ (by intros; simp) first last⟩
    | constructorReturned mid code => exact ⟨false,.blockExit n xs child ys inside c r k before after out _ (by intros; simp) first last⟩
    | selfdestructed mid => exact ⟨false,.blockExit n xs child ys inside c r k before after out _ (by intros; simp) first last⟩
    | reverted mid err => exact ⟨false,.blockExit n xs child ys inside c r k before after out _ (by intros; simp) first last⟩
    | broke mid => exact ⟨false,.blockExit n xs child ys inside c r k before after out _ (by intros; simp) first last⟩
    | continued mid => exact ⟨false,.blockExit n xs child ys inside c r k before after out _ (by intros; simp) first last⟩
  | capture n names child inside ih =>
    rw [Stmt.eval] at run
    change Interaction.Executes ((Stmt.eval n table c r child >>= captureNext names) >>= k) trace (.ok out) at run
    obtain ⟨branch,next⟩ := ih c r (fun v => captureNext names v >>= k) trace out (by simpa only [assoc] using run)
    exact ⟨branch,.capture n names child inside c r k trace out branch next⟩
  | call n targets key args fn found inside ih =>
    rw [Stmt.eval] at run
    change Interaction.Executes (((Expr.evalRefArgList c r args).caught >>= callNext n table c r targets key) >>= k) trace (.ok out) at run
    rw [assoc] at run
    obtain ⟨v,before,after,split,first,last⟩ := bindSuccess _ _ _ _ run
    subst trace
    cases v with
    | error err => exact ⟨false,.callError n targets key args fn found inside c r k before after out err first last⟩
    | ok pair =>
      obtain ⟨values,mid⟩ := pair
      cases entered : internalCallEnter? fn values mid with
      | none => exact ⟨false,.callRejected n targets key args fn found inside c r mid k before after out values first entered
          (by simpa only [callNext,found,entered] using last)⟩
      | some pair =>
        obtain ⟨inner,saved⟩ := pair
        obtain ⟨branch,next⟩ := ih {c with checked := true} inner
          (fun v => internalCallFinish fn targets saved v >>= k) after out
          (by simpa only [callNext,found,entered,assoc] using last)
        exact ⟨branch,.callEntered n targets key args fn found inside c r mid inner saved k before after out values branch first entered next⟩

/-- Internal frame isolation is derived from the actual successful entry
relation carried on the trace, rather than supplied as a desired frame. -/
theorem entryFrames (fn : InternalFunction) (values : List Value) (mid inner : Runtime)
    (saved : LocalEnv) (entered : internalCallEnter? fn values mid = some (inner,saved)) :
    saved = mid.locals ∧ ∃ frame, fn.initialFrame? values = some frame ∧
      inner = {mid with locals := [frame]} := by
  unfold internalCallEnter? at entered
  cases frame : fn.initialFrame? values with
  | none => simp [frame] at entered
  | some f =>
    simp only [frame,Option.some.injEq,Prod.mk.injEq] at entered
    exact ⟨entered.2.symm, f, rfl, entered.1.symm⟩
end Inv48.RequestClassify
