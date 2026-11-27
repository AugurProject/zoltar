import Inv48WrapperTraversalStructural
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
namespace Inv48.WrapperTraversal
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def prefixes (t : FunctionTable) (ss : List Stmt) :=
  ss.all (safe 100 t)

inductive Blocks (t : FunctionTable) (target : Stmt) : Nat → Stmt → Type where
  | here (n) : Blocks t target n target
  | capture (n) (names : List String) (body : Stmt) (next : Blocks t target n body) :
      Blocks t target (n+1) (.captureReturn names body)
  | block (n) (xs : List Stmt) (child : Stmt) (ys : List Stmt)
      (safe : prefixes t xs = true) (next : Blocks t target n child) :
      Blocks t target (n+1) (.block (xs++child::ys))

def Blocks.route : Blocks t target fuel stmt → Route t target fuel stmt
  | .here n => .here n
  | .capture n names body next => .capture n names body next.route
  | .block n xs child ys _ next => .block n xs child ys next.route

theorem prefixOut (t : FunctionTable) (ss : List Stmt) (safe : prefixes t ss = true)
    (n : Nat) (c : Context) (r : Runtime) (trace) (out)
    (run : Interaction.Executes (Stmt.evalList n t c r ss) trace (.ok out)) :
    (∃ mid, out = .normal mid) ∨ (∃ mid err, out = .reverted mid err) := by
  have good := listFalls n t c ss (fun s mem rt =>
    safeSound 100 s (List.all_eq_true.mp safe s mem) n c rt) r trace out run
  cases out with
  | normal mid => exact .inl ⟨mid,rfl⟩
  | reverted mid err => exact .inr ⟨mid,err,rfl⟩
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
  | capture n names body next ih =>
    rw [Stmt.eval] at run
    change Interaction.Executes ((Stmt.eval n t c r body >>= captureNext names) >>= k) trace (.ok out) at run
    apply ih c r (fun v => captureNext names v >>= k) trace out
    · intro mid err rest bad
      exact reject mid err rest bad
    · simpa only [assoc] using run
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



def Blocks.leafFuel : Blocks t target fuel stmt → Nat
  | .here n => n
  | .block _ _ _ _ _ next | .capture _ _ _ next => next.leafFuel

def Escapes : Result → Prop
  | .normal _ | .returned .. => False
  | _ => True

def Rejects (k : Result → SolI Result) (out : Result) :=
  ∀ v, Escapes v → ∀ trace, ¬ Interaction.Executes (k v) trace (.ok out)

theorem site (b : Blocks t target fuel stmt) (c : Context) (r : Runtime)
    (k : Result → SolI Result) (trace : Interaction.Transcript) (out : Result)
    (reject : Rejects k out)
    (run : Interaction.Executes (Stmt.eval fuel t c r stmt >>= k) trace (.ok out)) :
    ∃ s : Site (Stmt.eval fuel t c r stmt >>= k) t target trace out,
      s.fuel = b.leafFuel ∧ Rejects s.continuation out := by
  induction b generalizing c r k trace out with
  | here n => exact ⟨⟨n,c,r,k,[],trace,by simp,.refl _,run⟩,rfl,reject⟩
  | capture n names body next ih =>
    rw [Stmt.eval] at run
    change Interaction.Executes ((Stmt.eval n t c r body >>= captureNext names) >>= k) trace (.ok out) at run
    have rej : Rejects (fun v => captureNext names v >>= k) out := by
      intro v bad tr exec
      cases v <;> try contradiction
      all_goals apply reject _ ?_ tr exec <;> trivial
    obtain ⟨s,eq,rej⟩ := ih c r (fun v => captureNext names v >>= k) trace out rej (by simpa only [assoc] using run)
    exact ⟨{s with reached := by simpa only [Stmt.eval,assoc] using s.reached},eq,rej⟩
  | block n xs child ys safe next ih =>
    rw [blockSplit,assoc] at run
    obtain ⟨v,before,after,split,first,last⟩ := bindSuccess _ _ _ _ run
    rcases prefixOut t xs safe n c r.pushScope before v first with ⟨mid,rfl⟩ | ⟨mid,err,rfl⟩
    · have rej : Rejects (fun v => (listNext n t c ys v >>= pop) >>= k) out := by
        intro v bad tr exec
        cases v <;> try contradiction
        all_goals apply reject _ ?_ tr exec <;> trivial
      obtain ⟨s,eq,rej⟩ := ih c mid (fun v => (listNext n t c ys v >>= pop) >>= k) after out rej
        (by simpa only [assoc] using last)
      refine ⟨⟨s.fuel,s.context,s.runtime,s.continuation,before++s.before,s.after,?_,?_,s.suffix⟩,eq,rej⟩
      · exact split.trans ((congrArg (fun tr => before++tr) s.split).trans (List.append_assoc _ _ _).symm)
      · rw [blockSplit,assoc]
        exact (Prefix.ofExecution first _).trans (by simpa only [assoc] using s.reached)
    · exact False.elim (reject (.reverted mid.popScope err) trivial after last)
end Inv48.WrapperTraversal
