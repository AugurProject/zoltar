import Inv08AuthorityDecode
open SolidCore.Solidity.Source Inv03.Bodies
namespace Inv08.Authority
def boundFnKey (bound : Bool) := if bound then boundKey else ledgerKey
def retName (bound : Bool) := if bound then "binding" else "_ret0"
def selected (bound : Bool) := model.core.table.lookup? (boundFnKey bound)
private theorem present (bound : Bool) : (selected bound).isSome := by cases bound <;> native_decide
def fn (bound : Bool) := (selected bound).get (present bound)
def retDecl (bound : Bool) : BindingDecl := ⟨retName bound,.address,false⟩
private def isAddressReturn (name : String) : List BindingDecl → Bool
  | [⟨n,.address,false⟩] => n==name
  | _ => false
theorem signature (bound : Bool) : (fn bound).params=[] ∧ (fn bound).returns=[retDecl bound] := by
  have hp : (fn bound).params.isEmpty := by cases bound <;> native_decide
  have hr : isAddressReturn (retName bound) (fn bound).returns := by cases bound <;> native_decide
  refine ⟨List.isEmpty_iff.mp hp,?_⟩
  generalize eq : (fn bound).returns = ds at *
  unfold isAddressReturn at hr
  split at hr
  · simp only [beq_iff_eq] at hr
    rw [hr]; rfl
  · contradiction
theorem fnBody (bound : Bool) : (fn bound).body = (if bound then boundBody else ledgerBody).value := by
  have h : model.core.table.lookup? (boundFnKey bound) = some (fn bound) := (Option.some_get _).symm
  cases bound with
  | false =>
    change model.core.table.lookup? ledgerKey = _ at h
    have eq := ledgerCode
    rw [h] at eq; exact Option.some.inj eq
  | true =>
    change model.core.table.lookup? boundKey = _ at h
    have eq := boundCode
    rw [h] at eq; exact Option.some.inj eq

def fresh (r : Runtime) (bound : Bool) := ({r with locals:=[]}).withFrame [(retName bound,.word 0)]

theorem enters (r : Runtime) (bound : Bool) : internalCallEnter? (fn bound) [] r = some (fresh r bound,r.locals) := by
  unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
  rw [(signature bound).1,(signature bound).2]
  simp [BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,retDecl,Ty.defaultValue,fresh,Runtime.withFrame]

theorem boundCall (n : Nat) (c : Context) (r : Runtime) (targets : List String) (size : (bytes c r).length=65) :
    Stmt.eval (n+28) model.core.table c r (.internalCall targets boundKey []) =
      internalCallAssign (post c r) targets [.word (prefixWord (bytes c r) 20)] := by
  let empty := {r with locals:=[]}
  let val := prefixWord (bytes c r) 20
  let out := boundEntry (post c empty) val
  have ev := decode n model.core.table {c with checked:=true} empty size
  change Stmt.eval (n+27) model.core.table {c with checked:=true} (fresh r true) boundBody.value = pure (.normal out) at ev
  have bd : (fn true).body = boundBody.value := fnBody true
  rw [←bd] at ev
  have found : model.core.table.lookup? boundKey = some (fn true) := (Option.some_get _).symm
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ [] _ _ _ (by rfl) found (enters r true) ev]
  have values : collectReturnBindingsRef (fn true).returns out = .ok [.word val] := by
    rw [(signature true).2]
    simp [collectReturnBindingsRef,collectReturnBindingsRef.collect,retDecl,retName,out,boundEntry,Runtime.withFrame,
      Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,
      Ty.coerceValue?,Bind.bind,Except.bind]
  simp only [internalCallFinish,values]
  rfl
end Inv08.Authority
