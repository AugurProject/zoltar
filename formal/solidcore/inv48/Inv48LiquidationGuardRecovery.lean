import Inv48LiquidationActualFundingBodies
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace GuardRecovery
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
theorem bindSuccess {α β : Type} (first : SolI α) (next : α → SolI β)
    (trace : Interaction.Transcript) (out : β)
    (run : Interaction.Executes (first >>= next) trace (.ok out)) :
    ∃ value xs ys, trace = xs++ys ∧ Interaction.Executes first xs (.ok value) ∧
      Interaction.Executes (next value) ys (.ok out) := by
  rcases Interaction.Executes.bind_cases run with bad | good
  · obtain ⟨err,eq,_⟩ := bad
    cases eq
  · exact good
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

/-- Reuse the existing checked fallsThrough syntax. The no-catch external-call case preserves the exact INV12 policy. -/
def simpleFalls : Nat → Stmt → Bool
  | 0,_ => false
  | k+1,.block ss => ss.all (simpleFalls k)
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
      case skip => rw [Stmt.eval]; apply pureNever; intros; simp
      case block ss =>
        rw [Stmt.eval]
        intro trace rt vs run
        obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ run
        cases v <;> cases last
        exact listNever n t c ss (fun s mem r => ih s ((List.all_eq_true.mp safe) s mem) n r) r.pushScope _ _ _ first
private theorem pb {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl

theorem listAppend (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (xs ys : List Stmt) :
    Stmt.evalList fuel t c r (xs++ys) =
      (Stmt.evalList fuel t c r xs >>= fun
        | .normal mid => Stmt.evalList fuel t c mid ys
        | out => pure out) := by
  induction xs generalizing r with
  | nil => simp only [List.nil_append,Stmt.evalList]; rw [pb]
  | cons x xs ih =>
    simp only [List.cons_append,Stmt.evalList]
    change _ = Interaction.bind (Interaction.bind _ _) _
    rw [Interaction.bind_assoc]
    congr 1
    funext out
    cases out <;> try rfl
    exact ih _

def Escapes : Result → Prop
  | .normal _ | .returned .. => False
  | _ => True
/-- Invert a block without losing its actual child execution or transcript. -/
theorem block (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (ss : List Stmt) (tr : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes (Stmt.eval fuel t c r (.block ss)) tr (.ok out)) :
    ∃ n value, fuel = n+1 ∧ out = value.mapRuntime Runtime.popScope ∧
      Interaction.Executes (Stmt.evalList n t c r.pushScope ss) tr (.ok value) := by
  cases fuel with
  | zero => rw [Stmt.eval] at run; cases run
  | succ n =>
    rw [Stmt.eval] at run
    obtain ⟨v,a,b,split,first,last⟩ := bindSuccess _ _ _ _ run
    cases last
    simp only [List.append_nil] at split
    subst tr
    exact ⟨n,v,rfl,rfl,first⟩

/-- A nonescaping enclosing result makes the block child nonescaping. -/
theorem popOrdinary (v : Result) (h : ¬ Escapes (v.mapRuntime Runtime.popScope)) :
    ¬ Escapes v := by cases v <;> exact h

/-- A syntactically nonreturning prefix must finish normally when the enclosing
list has a nonescaping result. This uses the existing fuel-independent proof. -/
theorem listPrefix (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (xs ys : List Stmt) (tr : Interaction.Transcript) (out : Result)
    (safe : xs.all (simpleFalls 10) = true) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.evalList n t c r (xs++ys)) tr (.ok out)) :
    ∃ mid before after, tr = before++after ∧
      Interaction.Executes (Stmt.evalList n t c r xs) before (.ok (.normal mid)) ∧
      Interaction.Executes (Stmt.evalList n t c mid ys) after (.ok out) := by
  rw [listAppend] at run
  obtain ⟨v,a,b,split,first,last⟩ := bindSuccess _ _ _ _ run
  have never := listNever n t c xs
    (fun s mem rt => neverSound 10 s ((List.all_eq_true.mp safe) s mem) n t c rt) r
  cases v with
  | normal mid => exact ⟨mid,a,b,split,first,last⟩
  | returned rt vs => exact False.elim (never _ _ _ first)
  | _ => cases last; exact False.elim (ordinary trivial)
theorem singleton (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (s : Stmt) (tr : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes (Stmt.evalList n t c r [s]) tr (.ok out)) :
    Interaction.Executes (Stmt.eval n t c r s) tr (.ok out) := by
  rw [Stmt.evalList] at run
  obtain ⟨v,a,b,split,first,last⟩ := bindSuccess _ _ _ _ run
  cases v <;> simp only [Stmt.evalList] at last <;> cases last <;>
    simp only [List.append_nil] at split <;> subst tr <;> exact first
end GuardRecovery
