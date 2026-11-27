import Inv48WrapperTraversalNoReturn
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.FundingFallthrough
namespace Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
def Falls : Result → Prop
  | .normal _ | .reverted .. => True
  | _ => False
def Falling (tree : SolI Result) := ∀ trace out,
  Interaction.Executes tree trace (.ok out) → Falls out

theorem baseFalls (s : Stmt) (h : (checked 100 t s && simpleFalls 100 s) = true)
    (n c r) : Falling (Stmt.eval n t c r s) := by
  simp only [Bool.and_eq_true] at h
  intro trace out run
  have ordinary := sound 100 s t h.1 n c r trace out run
  have never := neverSound 100 s h.2 n t c r
  cases out with
  | normal _ => trivial
  | reverted _ _ => trivial
  | returned rt vs => exact False.elim (never trace rt vs run)
  | _ => contradiction

theorem pureFalls (out : Result) (h : Falls out) : Falling (pure out) := by
  intro trace result run; cases run; exact h

theorem bindFalls {α : Type} (tree : SolI α) (next : α → SolI Result)
    (h : ∀ x, Falling (next x)) : Falling (tree >>= next) := by
  intro trace out run
  obtain ⟨x,_,_,_,_,last⟩ := bindSuccess _ _ _ _ run
  exact h x _ _ last

theorem listFalls (n t c) (ss : List Stmt)
    (h : ∀ s ∈ ss, ∀ r, Falling (Stmt.eval n t c r s)) (r : Runtime) :
    Falling (Stmt.evalList n t c r ss) := by
  induction ss generalizing r with
  | nil => rw [Stmt.evalList]; exact pureFalls _ trivial
  | cons s ss ih =>
    intro trace out run
    rw [Stmt.evalList] at run
    obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ run
    have good := h s List.mem_cons_self r _ _ first
    cases v with
    | normal mid => exact ih (fun s mem => h s (List.mem_cons_of_mem _ mem)) mid _ _ last
    | reverted mid err => cases last; trivial
    | _ => contradiction

theorem scopeFalls (tree : SolI Result) (h : Falling tree) :
    Falling (tree >>= fun v => pure (v.mapRuntime Runtime.popScope)) := by
  intro trace out run
  obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ run
  have good := h _ _ first
  cases v <;> cases last <;> exact good

/-- All finite successful validation runs fall through or revert. No bound on
batch length and no concrete execution of the loop is used. -/
theorem forFalls (t : FunctionTable) (c : Context) (cond : Expr) (post body : Stmt)
    (safeBody : ∀ n rt, Falling (Stmt.eval n t c rt body))
    (safePost : ∀ n rt, Falling (Stmt.eval n t c rt post)) (n : Nat) (r : Runtime) :
    Falling (Stmt.evalFor n t c r cond post body) := by
  induction n generalizing r with
  | zero => intro trace out run; rw [Stmt.evalFor] at run; cases run
  | succ n ih =>
    rw [Stmt.evalFor]
    apply bindFalls
    rintro (err|⟨value,mid⟩)
    · exact pureFalls _ trivial
    · dsimp only
      split
      · split
        · intro trace out run
          obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ run
          have good := safeBody n mid _ _ first
          cases v with
          | normal q =>
            obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ last
            have good := safePost n q _ _ first
            cases v with
            | normal q => exact ih q _ _ last
            | reverted q err => cases last; trivial
            | _ => contradiction
          | reverted q err => cases last; trivial
          | _ => contradiction
        · exact pureFalls _ trivial
      · exact pureFalls _ trivial

def safe : Nat → FunctionTable → Stmt → Bool
  | 0,_,_ => false
  | k+1,t,.block ss => ss.all (safe k t)
  | k+1,t,.forLoop init _ post body => safe k t init && safe k t post && safe k t body
  | _+1,t,s => checked 100 t s && simpleFalls 100 s

theorem safeSound (k : Nat) (s : Stmt) (h : safe k t s = true)
    (n c r) : Falling (Stmt.eval n t c r s) := by
  induction k generalizing s n r with
  | zero => cases h
  | succ k ih =>
    cases n with
    | zero => intro trace out run; rw [Stmt.eval] at run; cases run
    | succ n =>
      cases s <;> try exact baseFalls _ (by simpa only [safe] using h) (n+1) c r
      case block ss =>
        simp only [safe] at h
        rw [Stmt.eval]
        exact scopeFalls _ (listFalls n t c ss (fun s mem rt => ih s (List.all_eq_true.mp h s mem) n rt) r.pushScope)
      case forLoop init cond post body =>
        simp only [safe,Bool.and_eq_true] at h
        rw [Stmt.eval]
        intro trace out run
        obtain ⟨v,_,_,_,first,last⟩ := bindSuccess _ _ _ _ run
        have good := ih init h.1.1 n r.pushScope _ _ first
        cases v with
        | normal mid => exact scopeFalls _ (forFalls t c cond post body
            (fun n rt => ih body h.2 n rt) (fun n rt => ih post h.1.2 n rt) n mid) _ _ last
        | reverted mid err => cases last; trivial
        | _ => contradiction
end Inv48.WrapperTraversal
