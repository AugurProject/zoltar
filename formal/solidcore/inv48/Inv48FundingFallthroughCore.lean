import Inv48RequestClassifyPublic
import Inv12NoEarlyExit
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch
namespace Inv48.FundingFallthrough
set_option pp.deepTerms false
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
/-- No constructor return, selfdestruct, break or continue can escape. Ordinary
returns are allowed here, since internal finish/capture consume them. -/
def Ordinary : Result → Prop
  | .normal _ | .returned .. | .reverted .. => True
  | _ => False

def Ensures (tree : SolI Result) := ∀ trace out,
  Interaction.Executes tree trace (.ok out) → Ordinary out

theorem pureOrdinary (out : Result) (h : Ordinary out) : Ensures (pure out) := by
  intro trace result run
  cases run
  exact h

theorem bindOrdinary {α : Type} (tree : SolI α) (next : α → SolI Result)
    (h : ∀ x, Ensures (next x)) : Ensures (tree >>= next) := by
  intro trace out run
  obtain ⟨x,_,_,_,_,last⟩ := bindSuccess _ _ _ _ run
  exact h x _ _ last

macro "ordinary_leaf" : tactic => `(tactic|
  (rw [Stmt.eval]; dsimp only
   repeat' first | apply pureOrdinary; trivial |
     (apply bindOrdinary; intro x; try dsimp only) | (split <;> try dsimp only)))

def checked : Nat → FunctionTable → Stmt → Bool
  | 0,_,_ => false
  | k+1,t,.block ss => ss.all (checked k t)
  | k+1,t,.captureReturn _ s | k+1,t,.checked s | k+1,t,.unchecked s => checked k t s
  | k+1,t,.internalCall _ key _ => (t.lookup? key).any (fun fn => checked k t fn.body)
  | k+1,t,.whileLoop _ body => checked k t body
  | k+1,t,.tryExternalCall _ _ _ _ _ _ _ _ _ body [] => checked k t body
  | k+1,t,.ifElse _ a b => checked k t a && checked k t b
  | _+1,_,.assign .. | _+1,_,.varDecl .. | _+1,_,.memoryVarDecl .. |
    _+1,_,.memoryLocalize .. | _+1,_,.requireStmt .. | _+1,_,.exprStmt .. | _+1,_,.returnValues .. |
    _+1,_,.revert .. | _+1,_,.revertError .. | _+1,_,.skip => true
  | _+1,_,_ => false

theorem assignOrdinary (n t c r l e) : Ensures (Stmt.eval (n+1) t c r (.assign l e)) := by ordinary_leaf
theorem varOrdinary (n t c r ty name init) : Ensures (Stmt.eval (n+1) t c r (.varDecl ty name init)) := by ordinary_leaf
theorem memoryOrdinary (n t c r ty name init) : Ensures (Stmt.eval (n+1) t c r (.memoryVarDecl ty name init)) := by ordinary_leaf
theorem localizeOrdinary (n t c r ty name) : Ensures (Stmt.eval (n+1) t c r (.memoryLocalize ty name)) := by ordinary_leaf

theorem requireOrdinary (n t c r cond msg) : Ensures (Stmt.eval (n+1) t c r (.requireStmt cond msg)) := by ordinary_leaf
theorem exprOrdinary (n t c r e) : Ensures (Stmt.eval (n+1) t c r (.exprStmt e)) := by ordinary_leaf
theorem returnOrdinary (n t c r es) : Ensures (Stmt.eval (n+1) t c r (.returnValues es)) := by ordinary_leaf

theorem listOrdinary (n t c) (ss : List Stmt)
    (h : ∀ s ∈ ss, ∀ r, Ensures (Stmt.eval n t c r s)) (r : Runtime) :
    Ensures (Stmt.evalList n t c r ss) := by
  induction ss generalizing r with
  | nil => rw [Stmt.evalList]; exact pureOrdinary _ trivial
  | cons s ss ih =>
    intro trace out run
    rw [Stmt.evalList] at run
    obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ run
    have good := h s List.mem_cons_self r _ _ first
    cases v with
    | normal mid => exact ih (fun s mem => h s (List.mem_cons_of_mem _ mem)) mid _ _ last
    | returned mid vs => cases last; trivial
    | reverted mid err => cases last; trivial
    | _ => contradiction

theorem finishOrdinary (fn : InternalFunction) (targets : List String) (saved : LocalEnv)
    (out : Result) (h : Ordinary out) : Ensures (internalCallFinish fn targets saved out) := by
  cases out <;> try contradiction
  all_goals simp only [internalCallFinish]
  all_goals repeat' first | apply pureOrdinary; trivial | split
  all_goals unfold internalCallAssign
  all_goals repeat' first | apply pureOrdinary; trivial | split

theorem scopeOrdinary (tree : SolI Result) (h : Ensures tree) :
    Ensures (tree >>= fun v => pure (v.mapRuntime Runtime.popScope)) := by
  intro trace out run
  obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ run
  have good := h _ _ first
  cases v <;> cases last <;> exact good

theorem tryOrdinary (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (kind : LowLevelCallKind) (target data value : Expr) (gas : Option Expr) (first check : Bool)
    (returns : List BindingDecl) (cleanups : List AbiCleanup) (body : Stmt)
    (safe : ∀ rt, Ensures (Stmt.eval n t c rt body)) :
    Ensures (Stmt.eval (n+1) t c r (.tryExternalCall kind target data value gas first check returns cleanups body [])) := by
  rw [Stmt.eval]; dsimp only
  repeat' first | (apply pureOrdinary; trivial) |
    (apply scopeOrdinary; exact safe _) |
    (simp only [Inv12.noCatch] at *; done) |
    (split <;> try dsimp only) | (apply bindOrdinary; intro x; try dsimp only)
  all_goals simp only [Inv12.noCatch] at *
  all_goals contradiction

theorem whileOrdinary (t : FunctionTable) (c : Context) (cond : Expr) (body : Stmt)
    (safe : ∀ n rt, Ensures (Stmt.eval n t c rt body)) (n : Nat) (r : Runtime) :
    Ensures (Stmt.evalWhile n t c r cond body) := by
  induction n generalizing r with
  | zero => intro trace out run; rw [Stmt.evalWhile] at run; cases run
  | succ n ih =>
    rw [Stmt.evalWhile]
    apply bindOrdinary
    rintro (err|⟨value,mid⟩)
    · exact pureOrdinary _ trivial
    · dsimp only
      split
      · split
        · intro trace out run
          obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ run
          have good := safe n mid _ _ first
          cases v with
          | normal q => exact ih q _ _ last
          | returned q vs => cases last; trivial
          | reverted q err => cases last; trivial
          | _ => contradiction
        · exact pureOrdinary _ trivial
      · exact pureOrdinary _ trivial

theorem sound (k : Nat) (stmt : Stmt) (t : FunctionTable) (safe : checked k t stmt = true)
    (fuel : Nat) (c : Context) (r : Runtime) : Ensures (Stmt.eval fuel t c r stmt) := by
  induction k generalizing stmt fuel c r with
  | zero => cases safe
  | succ k ih =>
    cases fuel with
    | zero => intro trace out run; rw [Stmt.eval] at run; cases run
    | succ n =>
      cases stmt <;> try simp only [checked] at safe
      all_goals first | contradiction | apply assignOrdinary | apply varOrdinary |
        apply memoryOrdinary | apply requireOrdinary | apply exprOrdinary |
        apply returnOrdinary | apply localizeOrdinary | skip
      case revert name args => ordinary_leaf
      case whileLoop cond body =>
        rw [Stmt.eval]
        exact whileOrdinary t c cond body (fun n rt => ih body safe n c rt) n r
      case tryExternalCall kind target data value gas first check returns cleanups body catches =>
        cases catches with
        | nil =>
          simp only [checked] at safe
          exact tryOrdinary n t c r kind target data value gas first check returns cleanups body (fun rt => ih body safe n c rt)
        | cons a rest =>
          simp only [checked] at safe
          cases safe
      case checked body =>
        rw [Stmt.eval]
        exact ih body safe n _ r
      case unchecked body =>
        rw [Stmt.eval]
        exact ih body safe n _ r
      case skip =>
        rw [Stmt.eval]
        exact pureOrdinary _ trivial
      case revertError reason =>
        rw [Stmt.eval]
        cases reason <;> exact pureOrdinary _ trivial
      case block ss =>
        rw [Stmt.eval]
        intro trace out run
        obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ run
        have good := listOrdinary n t c ss (fun s mem r => ih s ((List.all_eq_true.mp safe) s mem) n c r) r.pushScope _ _ first
        cases v <;> cases last <;> exact good
      case captureReturn names body =>
        rw [Stmt.eval]
        intro trace out run
        obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ run
        have good := ih body safe n c r _ _ first
        cases v <;> try contradiction
        all_goals dsimp only at last
        all_goals repeat' first | (split at last) | (cases last; trivial)
      case internalCall targets key args =>
        rw [Stmt.eval]
        apply bindOrdinary
        rintro (err|⟨values,mid⟩)
        · exact pureOrdinary _ trivial
        · cases found : t.lookup? key with
          | none => simp [found] at safe
          | some fn =>
            simp only [found,Option.any_some] at safe
            dsimp only
            split
            · exact pureOrdinary _ trivial
            · rename_i inner saved entered
              intro trace out run
              obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ run
              exact finishOrdinary fn targets saved v (ih fn.body safe n _ inner _ _ first) _ _ last
      case ifElse cond yes no =>
        simp only [Bool.and_eq_true] at safe
        rw [Stmt.eval]
        apply bindOrdinary
        rintro (err|⟨value,mid⟩)
        · exact pureOrdinary _ trivial
        · dsimp only
          split
          · split
            · exact ih yes safe.1 n c mid
            · exact ih no safe.2 n c mid
          · exact pureOrdinary _ trivial
end Inv48.FundingFallthrough
