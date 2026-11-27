import Inv02Getter
import CheckedWordCall

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv02.Call

private def args (rep k m : Nat) : List Source.Value := [.word rep,.word k,.word m]
private def entryFrame (rep k m : Nat) : Frame :=
  [("rep",.word rep),("commitment",.word k),("multiplier",.word m),("_ret0",.word 0)]
private theorem initialFrame (fn : FunctionDef) (ps : fn.params = Inv32Internal.wordBindings ["rep","commitment","multiplier"])
    (rs : fn.returns = Inv32Internal.wordBindings ["_ret0"]) (rep k m : Nat) :
    fn.initialFrame? (args rep k m) = some (entryFrame rep k m) := by
  unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
  rw [ps,rs]
  simp [args,entryFrame,Inv32Internal.wordBindings,BindingDecl.bindArgs?,BindingDecl.bindArg?,
    BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue]
abbrev ctx := CheckedWordCall.ctx

def maximumHealthyPrice (model : TypeCheck.CheckedContract) (s : State) (rep k m : Nat) :=
  CheckedWordCall.read model s "maximumHealthyPrice" (args rep k m)

theorem publicPrice (model : TypeCheck.CheckedContract) (fn : FunctionDef)
    (found : model.core.findFunctionByName? "maximumHealthyPrice" = some fn)
    (params : fn.params = Inv32Internal.wordBindings ["rep","commitment","multiplier"])
    (returns : fn.returns = Inv32Internal.wordBindings ["_ret0"])
    (body : fn.body = Getter.body) (prod : Inv32Internal.ProductLinked model.core.table)
    (floor : Inv32FloorCall.FloorLinked model.core.table) (accepts : fn.acceptsValue (ctx model).value = true)
    (s : State) (rep k m : Nat) (hr : rep<R) (hk : k<R) (hm : m<R)
    (kp : 0<k) (mp : 0<m) (baseFits : rep*10000/m<R) (priceFits : price rep k m<R) :
    maximumHealthyPrice model s rep k m = some (price rep k m) := by
  let c := ctx model
  have frameOk := initialFrame fn params returns rep k m
  have ev := Getter.run 49982 model.core.table prod floor c (CheckedWordCall.initial c s)
    rep k m hr hk hm kp mp baseFits priceFits
  rw [← body] at ev
  exact CheckedWordCall.returnsWord model fn _ s _ _ _ found frameOk returns accepts ev

end Inv02.Call
