import Inv12Ref
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv12

def mappedRef (slot key : Nat) (members : List StorageLayout) : Ref :=
  ⟨mappingStorageSlot slot key,members⟩
def Ref.value (a : Ref) := Value.storageSlotRef a.slot (.struct a.members)

theorem mappedBinding (c : Context) (r : Runtime) (fieldName : String) (field : StorageField)
    (members : List StorageLayout) (key : Nat) (fit : key<R) (found : c.storageField? fieldName=some field)
    (persistent : field.transient=false) (layout : field.layout?=some (.mapping .uint256 (.struct members))) :
    r.bindStorageRef c (.field fieldName) [.word key]=.ok (mappedRef field.slot key members).value := by
  have anchor : r.storageBaseAnchor c (.field fieldName) [.word key]=.ok (field.slot,.mapping .uint256 (.struct members)) := by
    simp [Runtime.storageBaseAnchor,found,persistent,layout,Bind.bind,Except.bind,Pure.pure,Except.pure]
  have hashed : mappingStorageSlotForKey field.slot .uint256 (.word key)=.ok (mappingStorageSlot field.slot key) := by
    simp [mappingStorageSlotForKey,coerceMappingKeyWordAs,Value.forceAbiLazy,Ty.coerceValue?,Value.asStorageWord?,
      show Shared.norm key=key from Nat.mod_eq_of_lt fit,Bind.bind,Except.bind]
  simp [Runtime.bindStorageRef,Runtime.resolveStorageBasePath,anchor,State.resolveStoragePathSlot,hashed,
    Bind.bind,Except.bind,mappedRef,Ref.value]

theorem aliasStep (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name field keyName : String) (key : Nat)
    (a : Ref) (look : r.lookupLocal? keyName=some (.word key))
    (bind : r.bindStorageRef c (.field field) [.word key]=.ok a.value) :
    Stmt.eval (n+1) t c r (.storageAliasPath name field [.var keyName])=pure (.normal (r.declareLocal name a.value)) := by
  have vals : Expr.evalList c r [.var keyName]=pure ([.word key],r) := by
    unfold Expr.evalList
    simp only [Expr.listEvalFuel,Expr.orderFuel,Nat.reduceAdd,Expr.evalListFuel,
      Inv32Guards.readWord _ _ _ _ _ look,Inv08.Authority.bindPure]
  rw [Stmt.eval]; dsimp only; rw [vals]
  change (match r.bindStorageRef c (.field field) [.word key] with
    | .ok v => (pure (.normal (r.declareLocal name v)) : SolI Result)
    | .error err => pure (.reverted r err))=_
  rw [bind]

theorem Ref.declared (a : Ref) (r : Runtime) (name : String) : a.bound (r.declareLocal name a.value) name := by
  cases eqn : r.locals <;>
    simp [Ref.bound,Ref.value,Runtime.lookupStorageBase?,Runtime.lookupLocal?,Runtime.declareLocal,
      LocalEnv.lookup?,LocalEnv.declare,Frame.lookup?,eqn]
end Inv12
