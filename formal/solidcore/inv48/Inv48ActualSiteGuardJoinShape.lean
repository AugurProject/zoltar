import Inv48AllGuardsClosed
import Inv48WrapperTraversalPublic
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestClassify Inv48.RequestPrologue Inv48.GuardArgsFrame
namespace Inv48.ActualSiteGuardJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 400000

def innerTail := Inv48.RequestQuote.actual.drop 7
def outerTail (fn : InternalFunction) := (outer fn.body).drop 7

theorem dropAt {α : Type} (xs : List α) (i : Nat) (x : α) (h : xs[i]? = some x) :
    xs.drop i = x :: xs.drop (i+1) := by
  have len : i < xs.length := List.getElem?_eq_some_iff.mp h |>.1
  rw [List.drop_eq_getElem_cons len]
  have eq : xs[i] = x := List.getElem?_eq_some_iff.mp h |>.2
  rw [eq]

theorem takeFive (xs : List Stmt) (h : 5 ≤ xs.length) :
    xs.take 5 = [xs[0]?.getD .skip,xs[1]?.getD .skip,xs[2]?.getD .skip,
      xs[3]?.getD .skip,xs[4]?.getD .skip] := by
  match xs with
  | a::b::c::d::e::rest => rfl
  | [] | [_] | [_,_] | [_,_,_] | [_,_,_,_] => simp_all

theorem shape (fn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn) :
    fn.body = .block (cleanup ++ .block (guards ++ guard 5 :: quoteBlockP.value :: innerTail) :: outerTail fn) := by
  have clean := (metadata fn registered).2.2
  have nonempty : Inv48.RequestQuote.actual ≠ [] := by
    intro eq
    have h := actualQuoteBlock
    rw [eq] at h
    contradiction
  have definition : Inv48.RequestQuote.actual =
      (match fn.body with
       | .block ss => match ss[6]? with
         | some (Stmt.block inner) => inner
         | _ => []
       | _ => []) := by unfold Inv48.RequestQuote.actual; rw [registered]; rfl
  have decomposition : ∃ ss inner, fn.body = .block ss ∧ ss[6]? = some (Stmt.block inner) ∧ Inv48.RequestQuote.actual = inner := by
    cases eq : fn.body <;> try {simp only [eq] at definition; exact False.elim (nonempty definition)}
    case block ss =>
      simp only [eq] at definition
      cases nth : ss[6]? with
      | none => rw [nth] at definition; exact False.elim (nonempty definition)
      | some child =>
        cases child <;> try {rw [nth] at definition; exact False.elim (nonempty definition)}
        case block inner => exact ⟨ss,inner,rfl,nth,by simpa only [nth] using definition⟩
  obtain ⟨ss,inner,bodyShape,nth,actualEq⟩ := decomposition
  have outerEq : outer fn.body = ss := by rw [bodyShape]; rfl
  rw [outerEq] at clean
  have len : 5 ≤ Inv48.RequestQuote.actual.length := by
    have h := List.getElem?_eq_some_iff.mp actualQuoteBlock |>.1
    omega
  have five : Inv48.RequestQuote.actual.take 5 = guards := takeFive _ len
  have fifth : Inv48.RequestQuote.actual[5]? = some (guard 5) := by
    have h := actualHoist
    simp only [Inv48.GuardArgsFrame.guard,h,Option.getD_some]
  have inside : inner = guards ++ guard 5 :: quoteBlockP.value :: innerTail := by
    rw [← actualEq]
    have split := List.take_append_drop 5 Inv48.RequestQuote.actual
    rw [five,dropAt _ 5 _ fifth] at split
    have next : Inv48.RequestQuote.actual.drop 6 = quoteBlockP.value :: innerTail := dropAt _ 6 _ actualQuoteBlock
    rw [next] at split
    exact split.symm
  have split := List.take_append_drop 6 ss
  rw [clean,dropAt _ 6 _ nth,inside] at split
  simpa only [outerTail,outerEq] using bodyShape.trans (congrArg Stmt.block split.symm)

end Inv48.ActualSiteGuardJoin
