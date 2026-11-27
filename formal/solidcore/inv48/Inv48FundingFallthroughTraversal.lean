import Inv48FundingFallthroughNoReturn
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify
namespace Inv48.FundingFallthrough
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def prefixes (t : FunctionTable) (ss : List Stmt) :=
  ss.all (fun s => checked 100 t s && simpleFalls 100 s && Inv12.fallsThrough 100 s)

inductive Blocks (t : FunctionTable) (target : Stmt) : Nat → Stmt → Type where
  | here (n) : Blocks t target n target
  | block (n) (xs : List Stmt) (child : Stmt) (ys : List Stmt)
      (safe : prefixes t xs = true) (next : Blocks t target n child) :
      Blocks t target (n+1) (.block (xs++child::ys))

def Blocks.route : Blocks t target fuel stmt → Route t target fuel stmt
  | .here n => .here n
  | .block n xs child ys _ next => .block n xs child ys next.route

structure CertifiedPlan (t : FunctionTable) (target stmt : Stmt) where
  depth : Nat
  build : ∀ n, Blocks t target (n+depth) stmt

def certifiedPlan (path : Path) (t : FunctionTable) (stmt : Stmt) :
    Option (CertifiedPlan t Inv48.RequestQuote.quoteCaptureP.value stmt) :=
  match path with
  | .here =>
    if h : Inv48.RequestQuote.quoteCaptureP.test stmt = true then
      some ⟨0,fun n => by rw [Inv48.RequestQuote.quoteCaptureP.sound stmt h]; exact .here n⟩
    else none
  | .block i next =>
    match stmt with
    | .block ss =>
      if h : prefixes t (ss.take i) = true then
        match split : ss.drop i with
        | [] => none
        | child::ys => do
          let p ← certifiedPlan next t child
          return ⟨p.depth+1,fun n => by
            have eq : ss.take i ++ child::ys = ss := by simpa only [split] using List.take_append_drop i ss
            rw [← eq]
            exact .block (n+p.depth) _ _ _ h (p.build n)⟩
      else none
    | _ => none
  | _ => none

theorem prefixOut (t : FunctionTable) (ss : List Stmt) (safe : prefixes t ss = true)
    (n : Nat) (c : Context) (r : Runtime) (trace) (out)
    (run : Interaction.Executes (Stmt.evalList n t c r ss) trace (.ok out)) :
    (∃ mid, out = .normal mid) ∨ (∃ mid err, out = .reverted mid err) := by
  have each := List.all_eq_true.mp safe
  have ordinary := listOrdinary n t c ss (fun s mem r =>
    sound 100 s t (by have h := each s mem; simp only [Bool.and_eq_true] at h; exact h.1.1) n c r) r trace out run
  have never := listNever n t c ss (fun s mem r =>
    neverSound 100 s (by have h := each s mem; simp only [Bool.and_eq_true] at h; exact h.1.2) n t c r) r
  cases out with
  | normal mid => exact .inl ⟨mid,rfl⟩
  | reverted mid err => exact .inr ⟨mid,err,rfl⟩
  | returned mid vs => exact False.elim (never _ _ _ run)
  | _ => contradiction

/-- Successful shared-body execution cannot take the classifier's false branch.
The nested capture inside a prefix is checked as a complete statement. -/
theorem follows (b : Blocks t target fuel stmt) (c : Context) (r : Runtime)
    (k : Result → SolI Result) (trace : Interaction.Transcript) (out : Result)
    (reject : ∀ mid err rest, ¬ Interaction.Executes (k (.reverted mid err)) rest (.ok out))
    (run : Interaction.Executes (Stmt.eval fuel t c r stmt >>= k) trace (.ok out)) :
    Follows b.route c r k trace out true := by
  induction b generalizing c r k trace out with
  | here n => exact ⟨rfl,run⟩
  | block n xs child ys safe next ih =>
    rw [blockSplit,assoc] at run
    obtain ⟨v,before,after,split,first,last⟩ := bindSuccess _ _ _ _ run
    rcases prefixOut t xs safe n c r.pushScope before v first with ⟨mid,rfl⟩ | ⟨mid,err,rfl⟩
    · refine ⟨.normal mid,before,after,split,first,?_⟩
      apply ih c mid (fun v => (listNext n t c ys v >>= pop) >>= k) after out
      · intro q err rest bad
        change Interaction.Executes (k (.reverted q.popScope err)) rest (.ok out) at bad
        exact reject _ _ _ bad
      · simpa only [assoc] using last
    · change Interaction.Executes (k (.reverted mid.popScope err)) after (.ok out) at last
      exact False.elim (reject _ _ _ last)

end Inv48.FundingFallthrough
