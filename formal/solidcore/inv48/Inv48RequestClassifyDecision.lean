import Inv48RequestClassifyTraversal
import Inv48RequestClassifyUnique
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch
namespace Inv48.RequestClassify
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

/-- Source-indexed branch predicate; every continuation is fixed by source. -/
def Follows (route : Route table target fuel stmt) (c : Context) (r : Runtime)
    (k : Result → SolI Result) (trace : Interaction.Transcript) (out : Result) (branch : Bool) : Prop :=
  match route with
  | .here _ => branch = true ∧ Interaction.Executes (Stmt.eval fuel table c r stmt >>= k) trace (.ok out)
  | .block n xs child ys inside =>
    ∃ v before after, trace = before++after ∧
      Interaction.Executes (Stmt.evalList n table c r.pushScope xs) before (.ok v) ∧
      match v with
      | .normal mid => Follows inside c mid (fun v => (listNext n table c ys v >>= pop) >>= k) after out branch
      | early => branch = false ∧ Interaction.Executes (pop early >>= k) after (.ok out)
  | .capture _ names _ inside => Follows inside c r (fun v => captureNext names v >>= k) trace out branch
  | .call n targets key args fn _ inside =>
    ∃ v before after, trace = before++after ∧
      Interaction.Executes (Expr.evalRefArgList c r args).caught before (.ok v) ∧
      match v with
      | .error err => branch = false ∧ Interaction.Executes (k (.reverted r err)) after (.ok out)
      | .ok (values,mid) =>
        match internalCallEnter? fn values mid with
        | none => branch = false ∧ Interaction.Executes (k (.reverted mid .typeMismatch)) after (.ok out)
        | some (inner,saved) => Follows inside {c with checked := true} inner
            (fun v => internalCallFinish fn targets saved v >>= k) after out branch

theorem followsOfTraversal (h : Traversal table target route c r k trace out branch) :
    Follows route c r k trace out branch := by
  induction h with
  | here => exact ⟨rfl,by assumption⟩
  | blockExit n xs child ys inside c r k before after out early nonnormal first last =>
    refine ⟨early,before,after,rfl,first,?_⟩
    cases early <;> simp_all
  | blockNext => exact ⟨_,_,_,rfl,by assumption,by assumption⟩
  | capture => assumption
  | callError n targets key args fn found inside c r k before after out err first last =>
    exact ⟨.error err,before,after,rfl,first,rfl,last⟩
  | callRejected n targets key args fn found inside c r mid k before after out values first entered last =>
    refine ⟨.ok (values,mid),before,after,rfl,first,?_⟩
    simpa only [entered] using (show false = false ∧
      Interaction.Executes (k (.reverted mid .typeMismatch)) after (.ok out) from ⟨rfl,last⟩)
  | callEntered n targets key args fn found inside c r mid inner saved k before after out values branch first entered next ih =>
    refine ⟨.ok (values,mid),before,after,rfl,first,?_⟩
    simpa only [entered] using ih

private theorem splitUnique {α : Type} {tree : SolI α} {trace xs ys left right : Interaction.Transcript}
    {a b : α} (ha : Interaction.Executes tree xs (.ok a)) (hb : Interaction.Executes tree ys (.ok b))
    (one : trace = xs++left) (two : trace = ys++right) : xs = ys ∧ a = b ∧ left = right := by
  obtain ⟨same,value⟩ := completedPrefixUnique ha hb (one.symm.trans two)
  refine ⟨same,value,?_⟩
  apply List.append_cancel_left (as := xs)
  exact one.symm.trans (two.trans (congrArg (fun t => t++right) same.symm))

/-- Disjointness: the same route and completed trace cannot be both branches. -/
theorem branchUnique (route : Route table target fuel stmt)
    (one : Follows route c r k trace out b) (two : Follows route c r k trace out d) : b = d := by
  induction route generalizing c r k trace out b d with
  | here => exact one.1.trans two.1.symm
  | block n xs child ys inside ih =>
    obtain ⟨v,before,after,split,first,last⟩ := one
    obtain ⟨v',before',after',split',first',last'⟩ := two
    obtain ⟨rfl,rfl,rfl⟩ := splitUnique first first' split split'
    cases v with
    | normal mid => exact ih last last'
    | returned mid values => exact last.1.trans last'.1.symm
    | constructorReturned mid code => exact last.1.trans last'.1.symm
    | selfdestructed mid => exact last.1.trans last'.1.symm
    | reverted mid err => exact last.1.trans last'.1.symm
    | broke mid => exact last.1.trans last'.1.symm
    | continued mid => exact last.1.trans last'.1.symm
  | capture n names child inside ih => exact ih one two
  | call n targets key args fn found inside ih =>
    obtain ⟨v,before,after,split,first,last⟩ := one
    obtain ⟨v',before',after',split',first',last'⟩ := two
    obtain ⟨rfl,rfl,rfl⟩ := splitUnique first first' split split'
    cases v with
    | error err => exact last.1.trans last'.1.symm
    | ok pair =>
      obtain ⟨values,mid⟩ := pair
      cases entered : internalCallEnter? fn values mid with
      | none => simp only [entered] at last last'; exact last.1.trans last'.1.symm
      | some pair =>
        obtain ⟨inner,saved⟩ := pair
        simp only [entered] at last last'
        exact ih last last'

/-- Exhaustive and disjoint partition, derived from actual source execution. -/
theorem exactPartition (route : Route table target fuel stmt) (c : Context) (r : Runtime)
    (k : Result → SolI Result) (trace : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes (Stmt.eval fuel table c r stmt >>= k) trace (.ok out)) :
    (Follows route c r k trace out false ∧ ¬ Follows route c r k trace out true) ∨
    (Follows route c r k trace out true ∧ ¬ Follows route c r k trace out false) := by
  obtain ⟨branch,witness⟩ := traversal route c r k trace out run
  have h := followsOfTraversal witness
  cases branch with
  | false => exact .inl ⟨h,fun other => Bool.noConfusion (branchUnique route h other)⟩
  | true => exact .inr ⟨h,fun other => Bool.noConfusion (branchUnique route h other)⟩
end Inv48.RequestClassify
