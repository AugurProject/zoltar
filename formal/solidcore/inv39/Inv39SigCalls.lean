import Inv39SafeCall
import Inv39SigLeaves
open SolidCore.Solidity.Source
namespace Inv39.Auth
def Certified (name : String) := ∃ f,model.core.table.lookup? name=some f ∧ signatureOk f ∧ ∀ c,guards true noWatch model.core.table c f.body
theorem returnsAllowed (d : BindingDecl) (ok : returnOk d) : permitted d.defaultBinding := by
  simp only [returnOk,Bool.and_eq_true,Bool.not_eq_true',Bool.or_eq_true] at ok
  simp only [BindingDecl.defaultBinding,ok.1,Bool.false_eq_true,if_false]
  apply Or.inr
  rcases ok.2 with scal|bytes
  · exact defaultSafe _ scal
  · split at bytes
    · rename_i e; simp [e,Ty.defaultValue,Init.safeTemplate]
    · contradiction

def callOK (names : List String) (w : Watch) (targets : List String) (key : String) (args : List Expr) :=
  names.contains key && targets.all (writable w) && args.all ordinaryVar

def extraCalls (names : List String) (w : Watch) : Extra
  | .captureReturn _ (.internalCall targets key args) | .internalCall targets key args=>callOK names w targets key args
  | _=>false
theorem callCertified (names : List String) (known : ∀ key∈names,Certified key) (allow : Bool) (w : Watch) (c : Context)
    (targets : List String) (key : String) (args : List Expr) (checked : callOK names w targets key args) :
    guards allow w model.core.table c (.internalCall targets key args) := by
  simp only [callOK,Bool.and_eq_true,List.contains_iff_mem] at checked
  obtain ⟨f,lookup,sig,body⟩ := known _ checked.1.1
  simp only [signatureOk,Bool.and_eq_true] at sig
  exact guardCall allow w noWatch _ c targets key args f lookup sig.1 (fun d hd=>returnsAllowed _ (List.all_eq_true.mp sig.2 d hd))
    (body _) checked.1.2 checked.2

theorem extraCertified (names : List String) (known : ∀ key∈names,Certified key) (allow : Bool) (w : Watch) (c : Context)
    (s : Stmt) (ok : extraCalls names w s) : guards allow w model.core.table c s := by
  unfold extraCalls at ok; split at ok
  · apply captureNormal; exact callCertified names known false w c _ _ _ ok
  · exact callCertified names known allow w c _ _ _ ok
  · contradiction
end Inv39.Auth
