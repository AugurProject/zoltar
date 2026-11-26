import Inv02Getter

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
private theorem dispatch (model : TypeCheck.CheckedContract) (fn : FunctionDef)
    (found : model.core.findFunctionByName? "maximumHealthyPrice" = some fn) (rep k m : Nat)
    (frameOk : fn.initialFrame? (args rep k m) = some (entryFrame rep k m)) :
    model.core.resolveCallFunction? (.name "maximumHealthyPrice") (args rep k m) = some fn := by
  obtain ⟨ok,before,after,parts,skip⟩ := List.find?_eq_some_iff_append.mp found
  apply List.find?_eq_some_iff_append.mpr
  refine ⟨?_,before,after,parts,?_⟩
  · simp [ok,frameOk]
  · intro fn mem
    have absent := skip fn mem
    simp_all

def ctx (model : TypeCheck.CheckedContract) : Source.Context := {model.core.context with selfDispatch? := some (Source.ABI.selfDispatchHook 50000 model.core 0)}
private def initial (ctx : Source.Context) (s : State) : Runtime :=
  {state := {s with selfBalance := Shared.addWord (Shared.Account.balanceAt ctx.accountBalances ctx.self) ctx.value,
                    worldMutatedSinceAdoption := true}, locals := []}

def maximumHealthyPrice (model : TypeCheck.CheckedContract) (s : State) (rep k m : Nat) : Option Nat := do
  let .returned _ [.word v] ← TypeCheck.CheckedContract.call? 50000 model
    (.name "maximumHealthyPrice") s (args rep k m) | none
  return v

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
  let start := Getter.frame (initial c s) rep k m
  have ev := Getter.run 49982 model.core.table prod floor c (initial c s)
    rep k m hr hk hm kp mp baseFits priceFits
  rw [← body] at ev
  have enter : fn.evalBodyEntry 50000 model.core.table c s (args rep k m) =
      some (Source.Stmt.eval 50000 model.core.table c start fn.body) := by
    unfold FunctionDef.evalBodyEntry
    rw [if_pos accepts,frameOk]; rfl
  have result : fn.callBodyResult s (.returned start [.word (price rep k m)]) =
      .returned {start.state with constructorOutput? := none} [.word (price rep k m)] := by
    simp [FunctionDef.callBodyResult,FunctionDef.coerceReturnValues,returns,Inv32Internal.wordBindings,
      coerceReturnBindings,coerceReturnBindings.coerce,Ty.coerceValue?,Runtime.derefMemoryValueDeep,
      Runtime.derefMemoryValueWithFuel,Bind.bind,Except.bind,Value.untagFixedBytes]
  unfold maximumHealthyPrice TypeCheck.CheckedContract.call? Source.ABI.Contract.callSelfDispatch?
    Source.ABI.Contract.callWithSelfDispatch
  rw [dispatch model fn found rep k m frameOk]
  change (do let .returned _ [.word v] ← fn.call? 50000 model.core.table c s (args rep k m)
               | none
             return v) = _
  unfold FunctionDef.call? FunctionDef.call
  rw [enter]
  change Source.Stmt.eval 50000 _ _ start fn.body = pure (.returned start [.word (price rep k m)]) at ev
  rw [ev]
  change (match fn.callBodyResult s (.returned start [.word (price rep k m)]) with
    | .returned _ [.word v] => some v | _ => none) = _
  rw [result]

end Inv02.Call
