import Inv44Shape
import Inv08AuthorityExpressions
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv44
def field : StorageField := {name:=addresses,slot:=0,layout? := some (.dynamicArray (.scalar .address))}
private def layout : Option StorageField → Bool
  | some ⟨"deploymentAddresses",0,none,some (.dynamicArray (.scalar .address)),false,0,32,false⟩=>true
  | _=>false
theorem fieldLookup (c : Context) (fields : c.storageFields=model.core.context.storageFields) :
    c.storageField? addresses=some field := by
  change c.storageFields.find? _ = _
  rw [fields]
  change model.core.context.storageField? addresses=_
  have h : layout (model.core.context.storageField? addresses) := by native_decide
  generalize model.core.context.storageField? addresses=x at *
  unfold layout at h; split at h
  · rfl
  · contradiction

def count (s : State) := s.loadSlot 0
/-- Address[] uses one word per element starting at keccak256(abi.encode(uint256(0))). -/
def slot (i : Nat) := normWord (Shared.norm (dynamicArrayDataSlot 0) + i)
def address (s : State) (i : Nat) := Shared.Account.addressWord (s.loadSlot (slot i))
def hasCode (c : Context) (s : State) (i : Nat) := !(s.envAccountCode c (address s i)).isEmpty

theorem countRead (c : Context) (r : Runtime) (fields : c.storageFields=model.core.context.storageFields)
    (fit : count r.state<R) : Inv40.Reads c r (Inv03.Bodies.clean header).value (count r.state) := by
  apply Inv08.ReleaseQuote.readClean _ fit
  have lookup := fieldLookup c fields
  have load : r.loadStorageFieldHeader c addresses = .ok (.word (count r.state)) := by
    unfold Runtime.loadStorageFieldHeader; rw [lookup]; change r.loadStorageField c addresses=_
    unfold Runtime.loadStorageField;rw [lookup];rfl
  intro fuel enough
  cases fuel with
  | zero => change 2≤0 at enough;omega
  | succ n =>
    change Expr.evalFuel (n+1) c r (.storageRead .header addresses [])=_
    rw [Expr.evalFuel]
    change (do let v ← liftM (r.loadStorageFieldHeader c addresses); pure (v,r))=_
    rw [load];rfl

theorem load (c : Context) (r : Runtime) (i : Nat) (fields : c.storageFields=model.core.context.storageFields)
    (bound : count r.state<R) (inside : i<count r.state) :
    r.loadStorageIndex c addresses (.word i)=.ok (.word (address r.state i)) := by
  have index : Shared.norm i=i := Nat.mod_eq_of_lt (inside.trans bound)
  have len : Shared.norm (r.state.loadSlot 0)=count r.state := Nat.mod_eq_of_lt bound
  have atSlot : dynamicArrayLayoutStorageSlotAndLayout? 0 i (.scalar .address) = some (slot i,.scalar .address) := by
    simp [dynamicArrayLayoutStorageSlotAndLayout?,StorageLayout.arrayElementOffsetAndLayout?,StorageLayout.slotSpan,slot,index,Bind.bind,Option.bind]
  unfold Runtime.loadStorageIndex;rw [fieldLookup _ fields]
  change (do let k ← Value.expectWord (.word i)
             if Shared.norm (r.state.loadSlot 0)≤Shared.norm k then Except.error RevertData.indexOutOfBounds
             else do let (s,l) ← (dynamicArrayLayoutStorageSlotAndLayout? 0 k (.scalar .address)).elim (Except.error RevertData.typeMismatch) Except.ok
                     r.state.loadStorageLayoutAt s l) = _
  simp only [Value.expectWord,index,len,Nat.not_le_of_lt inside,if_false,atSlot,Option.elim_some,Bind.bind,Except.bind]
  simp [State.loadStorageLayoutAt,StorageLayout.depth,State.loadStorageLayoutAtFuel,loadStorageWordAs,Ty.storageValueFromWord?,address]

theorem byteLength (c : Context) (r : Runtime) (i : Nat) (fields : c.storageFields=model.core.context.storageFields)
    (bound : count r.state<R) (inside : i<count r.state) (ix : r.lookupLocal? "index"=some (.word i)) :
    Inv40.Reads c r (Inv08.Authority.length code).value (r.state.envAccountCode c (address r.state i)).length := by
  have value (k : Nat) : Expr.evalFuel (k+3) c r element.value=pure (.word (address r.state i),r) := by
    change Expr.evalFuel _ c r (.storageRead .element addresses [.var "index"])=_
    rw [Expr.evalFuel]
    change (do let (v,s) ← Expr.evalFuel (k+2) c r (.var "index"); let a ← liftM (s.loadStorageIndex c addresses v); pure (a,s))=_
    rw [Inv32Guards.readWord (k+1) c r "index" i ix]; simp only [Inv08.Authority.bindPure,load c r i fields bound inside,Inv08.Authority.liftPure]
  have bytes (k : Nat) : Expr.evalFuel (k+4) c r code.value=pure (.bytes (r.state.envAccountCode c (address r.state i)),r) := by
    change Expr.evalFuel _ c r (.envBytesLookup .accountCode element.value)=_
    rw [Expr.evalFuel,value k]
    have fits : address r.state i<R := lt_trans (Nat.mod_lt _ (by decide : 0<Shared.Account.addressModulus)) (by decide : Shared.Account.addressModulus<R)
    simp only [Inv08.Authority.bindPure,Value.expectWord,Inv08.Authority.liftPure,show Shared.norm (address r.state i)=_ from Nat.mod_eq_of_lt fits]
  intro fuel enough
  change 6≤fuel at enough
  obtain ⟨k,rfl⟩ := Nat.exists_eq_add_of_le enough
  rw [Nat.add_comm]
  change Expr.evalFuel (k+6) c r (.length code.value)=_
  rw [Expr.evalFuel]
  have noRoot : (code.value.hasStorageRoot || code.value.hasStorageRefRoot r)=false := rfl
  simp only [noRoot,Bool.false_eq_true,if_false,bytes (k+1),Inv08.Authority.bindPure]
  rfl
  all_goals simp [code]
end Inv44
