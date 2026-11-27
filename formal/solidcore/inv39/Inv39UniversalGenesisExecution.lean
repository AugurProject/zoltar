import Inv39UniversalGenesisCore
import Inv39UniversalGenesisStorage
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.UniversalGenesis
set_option maxRecDepth 20000
set_option maxHeartbeats 0
set_option linter.unusedSimpArgs false
/-- The entry balance is the interpreter's context rebasing at zero call value. -/
def balance (c : Context) := Shared.addWord (Shared.Account.balanceAt c.accountBalances c.self) 0
def deployed (c : Context) (owner : Nat) : State :=
  { (Symbolic.freshMetadata (balance c)).storeImmutable "zoltar" (.word owner) with
    constructorOutput? := none }
def entryContext (c : Context) (sender : Nat) :=
  { c with
    sender:=sender
    value:=0
    construction:=true
    selfDispatch?:=some (ABI.selfDispatchHook 50000 model.core 0) }
/-- Real successful generated construction. Layout premises describe only consulted
fields; all remaining context components, including self and ambient environment,
are arbitrary. The input storage is fresh and the nonpayable call has zero value. -/
theorem construct (c : Context) (owner sender : Nat) (nonzero : Shared.norm owner≠0)
    (nameField : c.storageField? "_name"=some (Init.field .name))
    (symbolField : c.storageField? "_symbol"=some (Init.field .symbol))
    (immutableField : c.immutableField? "zoltar"=some ⟨"zoltar",.address⟩) :
    TypeCheck.CheckedContract.constructWithContext? 50000 model c State.empty sender 0 [.word owner]=
      some (.returned (deployed c owner) []) := by
  let ctx := entryContext c sender
  obtain ⟨dst,ev,state⟩ := Symbolic.run model.core.table ctx owner (balance c) nonzero
    nameField symbolField immutableField rfl
  have bodyEq : body=Symbolic.body := rfl
  rw [←bodyEq,←bodyFromSource] at ev
  have present : sourceFn=some ctor := (Option.some_get existsFn).symm
  have frame : ctor.initialFrame? [.word owner]=some [("_zoltar",.word owner)] := by
    simp [FunctionDef.initialFrame?,metaFromSource.1,metaFromSource.2.1,
      BindingDecl.bindArgs?,BindingDecl.bindArg?,Ty.coerceValue?,FunctionDef.returnDefaultBindings]
  have accepts : ctor.acceptsValue ctx.value=true := by
    simp [FunctionDef.acceptsValue,metaFromSource.2.2,ctx,entryContext,wordEq,Shared.norm]
  have run : ctor.evalBodyEntry 50000 model.core.table ctx State.empty [.word owner]=
      some (pure (.normal dst)) := by
    unfold FunctionDef.evalBodyEntry
    rw [accepts,frame]
    exact congrArg some ev
  have ret : ctor.collectReturns dst=.ok [] := by
    unfold FunctionDef.collectReturns
    rw [metaFromSource.2.1]
    rfl
  unfold TypeCheck.CheckedContract.constructWithContext?
  change sourceFn >>= _ = _
  rw [present]
  change ctor.call? 50000 model.core.table ctx State.empty [.word owner]=_
  unfold FunctionDef.call? FunctionDef.call
  rw [run]
  change some (ctor.callBodyResult State.empty (.normal dst))=_
  simp only [FunctionDef.callBodyResult,ret,List.map_nil]
  rw [state]
  rfl

theorem deploymentBooks (c : Context) (owner sender : Nat) (nonzero : Shared.norm owner≠0)
    (nameField : c.storageField? "_name"=some (Init.field .name))
    (symbolField : c.storageField? "_symbol"=some (Init.field .symbol))
    (immutableField : c.immutableField? "zoltar"=some ⟨"zoltar",.address⟩)
    (A : Nat → Prop) (keys : ∀ a, A a → Shared.norm (balanceSlot a)∉slots) :
    ∃ post, TypeCheck.CheckedContract.constructWithContext? 50000 model c State.empty sender 0 [.word owner]=
      some (.returned post []) ∧ Books A post [] ∧ post.loadSlot theoretical.slot=0 := by
  exact ⟨deployed c owner,construct c owner sender nonzero nameField symbolField immutableField,
    booksFromStorage (deployed c owner) (freshMetadataStorage (balance c)) A keys⟩
#print axioms construct
#print axioms deploymentBooks
end Inv39.UniversalGenesis
