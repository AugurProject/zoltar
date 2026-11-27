import Inv48FundingFallthroughCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch
namespace Inv48.FundingFallthrough
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
/-- Transcript-independent form of INV12's no-return argument. -/
def NeverReturns (tree : SolI Result) := ∀ trace r vs,
  ¬ Interaction.Executes tree trace (.ok (.returned r vs))
theorem pureNever (out : Result) (h : ∀ r vs, out ≠ .returned r vs) : NeverReturns (pure out) := by
  intro trace r vs run
  cases run
  exact h _ _ rfl
theorem bindNever {α : Type} (tree : SolI α) (next : α → SolI Result)
    (h : ∀ x, NeverReturns (next x)) : NeverReturns (tree >>= next) := by
  intro trace r vs run
  obtain ⟨x,_,_,_,_,last⟩ := bindSuccess _ _ _ _ run
  exact h x _ _ _ last
macro "never_leaf" : tactic => `(tactic|
  (rw [Stmt.eval]; dsimp only
   repeat' first | (apply pureNever; intros; simp) |
     (apply bindNever; intro x; try dsimp only) | (split <;> try dsimp only)))
theorem varNever (n t c r ty name init) : NeverReturns (Stmt.eval (n+1) t c r (.varDecl ty name init)) := by never_leaf
theorem memoryNever (n t c r ty name init) : NeverReturns (Stmt.eval (n+1) t c r (.memoryVarDecl ty name init)) := by never_leaf
theorem assignNever (n t c r l e) : NeverReturns (Stmt.eval (n+1) t c r (.assign l e)) := by never_leaf
theorem requireNever (n t c r cond msg) : NeverReturns (Stmt.eval (n+1) t c r (.requireStmt cond msg)) := by never_leaf
theorem exprNever (n t c r e) : NeverReturns (Stmt.eval (n+1) t c r (.exprStmt e)) := by never_leaf

theorem captureNever (n t c r names body) :
    NeverReturns (Stmt.eval (n+1) t c r (.captureReturn names body)) := by
  rw [Stmt.eval]
  apply bindNever
  intro v
  cases v <;> dsimp only
  all_goals repeat' first | (apply pureNever; intros; simp) | split

theorem assignCallNever (r : Runtime) (targets : List String) (values : List Value) :
    NeverReturns (internalCallAssign r targets values) := by
  unfold internalCallAssign
  repeat' first | (apply pureNever; intros; simp) | split

theorem finishNever (fn : InternalFunction) (targets : List String) (saved : LocalEnv) (v : Result) :
    NeverReturns (internalCallFinish fn targets saved v) := by
  cases v <;> simp only [internalCallFinish]
  all_goals repeat' first | apply assignCallNever | (apply pureNever; intros; simp) | split

theorem callNever (n t c r targets key args) :
    NeverReturns (Stmt.eval (n+1) t c r (.internalCall targets key args)) := by
  rw [Stmt.eval]
  repeat' first | apply finishNever | (apply pureNever; intros; simp) |
    (apply bindNever; intro x; try dsimp only) | (split <;> try dsimp only)

theorem listNever (n t c) (ss : List Stmt)
    (h : ∀ s ∈ ss, ∀ r, NeverReturns (Stmt.eval n t c r s)) (r : Runtime) :
    NeverReturns (Stmt.evalList n t c r ss) := by
  induction ss generalizing r with
  | nil => rw [Stmt.evalList]; apply pureNever; intros; simp
  | cons s ss ih =>
    intro trace rt vs run
    rw [Stmt.evalList] at run
    obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ run
    cases v with
    | normal mid => exact ih (fun s mem => h s (List.mem_cons_of_mem _ mem)) mid _ _ _ last
    | returned mid values => exact h s List.mem_cons_self r _ _ _ first
    | _ => cases last

theorem scopeNever (tree : SolI Result) (h : NeverReturns tree) :
    NeverReturns (tree >>= fun v => pure (v.mapRuntime Runtime.popScope)) := by
  intro trace rt vs run
  obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ run
  cases v <;> cases last
  exact h _ _ _ first

theorem tryNever (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (kind : LowLevelCallKind) (target data value : Expr) (gas : Option Expr) (first check : Bool)
    (returns : List BindingDecl) (cleanups : List AbiCleanup) (body : Stmt)
    (safe : ∀ rt, NeverReturns (Stmt.eval n t c rt body)) :
    NeverReturns (Stmt.eval (n+1) t c r (.tryExternalCall kind target data value gas first check returns cleanups body [])) := by
  rw [Stmt.eval]; dsimp only
  repeat' first | (apply pureNever; intros; simp) |
    (apply scopeNever; exact safe _) |
    (simp only [Inv12.noCatch] at *; done) |
    (split <;> try dsimp only) | (apply bindNever; intro x; try dsimp only)
  all_goals simp only [Inv12.noCatch] at *
  all_goals contradiction

/-- Reuse the existing checked fallsThrough syntax. The no-catch external-call case preserves the exact INV12 policy. -/
def simpleFalls : Nat → Stmt → Bool
  | 0,_ => false
  | k+1,.block ss => ss.all (simpleFalls k)
  | k+1,.tryExternalCall _ _ _ _ _ _ _ _ _ body [] => simpleFalls k body
  | _+1,.captureReturn .. | _+1,.assign .. | _+1,.varDecl .. |
    _+1,.memoryVarDecl .. | _+1,.requireStmt .. | _+1,.exprStmt .. |
    _+1,.internalCall .. | _+1,.skip => true
  | _+1,_ => false

theorem neverSound (k : Nat) (stmt : Stmt) (safe : simpleFalls k stmt = true)
    (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) : NeverReturns (Stmt.eval fuel t c r stmt) := by
  induction k generalizing stmt fuel r with
  | zero => cases safe
  | succ k ih =>
    cases fuel with
    | zero => intro trace rt vs run; rw [Stmt.eval] at run; cases run
    | succ n =>
      cases stmt <;> try simp only [simpleFalls] at safe
      all_goals first | contradiction | apply varNever | apply memoryNever | apply assignNever |
        apply requireNever | apply exprNever | apply captureNever | apply callNever | skip
      case tryExternalCall kind target data value gas first check returns cleanups body catches =>
        cases catches with
        | nil =>
          simp only [simpleFalls] at safe
          exact tryNever n t c r kind target data value gas first check returns cleanups body (fun rt => ih body safe n rt)
        | cons a rest =>
          simp only [simpleFalls] at safe
          cases safe
      case skip => rw [Stmt.eval]; apply pureNever; intros; simp
      case block ss =>
        rw [Stmt.eval]
        intro trace rt vs run
        obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ run
        cases v <;> cases last
        exact listNever n t c ss (fun s mem r => ih s ((List.all_eq_true.mp safe) s mem) n r) r.pushScope _ _ _ first
end Inv48.FundingFallthrough
