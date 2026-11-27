import Inv32FloorCall
import Inv32ExactCeil
import Inv32ExactComparison
import Inv32ExactForward
import Inv32ExactInverse
import Inv32ExactRatio
import Inv32ExactPanic
import Inv32ExactTernary
import Inv32RoundingHelper
import Inv32BoolHelper
open SolidCore.Solidity.Source
namespace Inv32Library
inductive Scalar | word (name : String) | flag (name : String) deriving DecidableEq
def decl : Scalar → BindingDecl
  | .word s => ⟨s,.uint256,false⟩
  | .flag s => ⟨s,.bool,false⟩
def decode : List BindingDecl → Option (List Scalar)
  | [] => some []
  | ⟨s,.uint256,false⟩ :: ds => (decode ds).map (.word s :: ·)
  | ⟨s,.bool,false⟩ :: ds => (decode ds).map (.flag s :: ·)
  | _ => none
theorem sound (ds : List BindingDecl) (xs : List Scalar) (h : decode ds = some xs) :
    ds = xs.map decl := by
  induction ds generalizing xs with
  | nil => cases h; rfl
  | cons x ds ih =>
    cases x with | mk n ty ref =>
      cases ty <;> cases ref <;> simp only [decode,reduceCtorEq] at h
      all_goals
        cases rest : decode ds <;> simp [rest] at h
        subst xs; rw [ih _ rest]; rfl
def metadataAt (t : FunctionTable) (key : String) := (t.lookup? key).bind fun f => do
  let ps ← decode f.params
  let rs ← decode f.returns
  pure (ps,rs)
def LinkAt (t : FunctionTable) (key : String) (ps rs : List Scalar) (body : Stmt) :=
  ∃ f, t.lookup? key = some f ∧ f.params = ps.map decl ∧
    f.returns = rs.map decl ∧ f.body = body
theorem linkAt (t : FunctionTable) (key : String) (ps rs : List Scalar) (body : Stmt)
    (sig : metadataAt t key = some (ps,rs))
    (b : ((t.lookup? key).map InternalFunction.body) = some body) :
    LinkAt t key ps rs body := by
  unfold metadataAt at sig
  cases h : t.lookup? key with
  | none => simp [h] at b
  | some f =>
    simp only [h,Option.bind_some] at sig
    cases hp : decode f.params <;> simp [hp] at sig
    cases hr : decode f.returns <;> simp [hr] at sig
    obtain ⟨rfl,rfl⟩ := sig
    exact ⟨f,h,sound _ _ hp,sound _ _ hr,by simpa [h] using b⟩

abbrev Link := LinkAt Inv32Dispatch.model.core.table
abbrev link := linkAt Inv32Dispatch.model.core.table
open Inv32Bodies.ToUint in
theorem linkToUint : Link key [.flag "b"] [.word "u"] body :=
  link _ _ _ _ (by native_decide) checkedBody
open Inv32Bodies.RoundsUp in
theorem linkRoundsUp : Link key [.word "rounding"] [.flag "_ret0"] body :=
  link _ _ _ _ (by native_decide) checkedBody
open Inv32Bodies.Ceil in
theorem linkCeil : Link key [.word "x", .word "y", .word "denominator", .word "rounding"] [.word "_ret0"] body :=
  link _ _ _ _ (by native_decide) checkedBody
open Inv32Bodies.Ternary in
theorem linkTernary : Link key [.flag "condition", .word "a", .word "b"] [.word "_ret0"] body :=
  link _ _ _ _ (by native_decide) checkedBody
open Inv32Bodies.Panic in
theorem linkPanic : Link key [.word "code"] [] body :=
  link _ _ _ _ (by native_decide) checkedBody
open Inv32Bodies.Comparison in
theorem linkComparison : Link key [.word "multiplier", .word "first", .word "second", .word "rightMultiplier", .word "rightValue"] [.flag "_ret0"] body :=
  link _ _ _ _ (by native_decide) checkedBody
open Inv32Bodies.Ratio in
theorem linkRatio : Link key [.word "scale", .word "numeratorPart", .word "otherPart"] [.word "_ret0"] body :=
  link _ _ _ _ (by native_decide) checkedBody
open Inv32Bodies.Forward in
theorem linkForward : Link key [.word "reserveIn", .word "reserveOut", .word "amountIn", .word "feeBps"] [.word "amountOut", .word "feeAmount"] body :=
  link _ _ _ _ (by native_decide) checkedBody
open Inv32Bodies.Inverse in
theorem linkInverse : Link key [.word "reserveIn", .word "reserveOut", .word "amountOut", .word "feeBps"] [.word "amountIn", .word "feeAmount"] body :=
  link _ _ _ _ (by native_decide) checkedBody
end Inv32Library
