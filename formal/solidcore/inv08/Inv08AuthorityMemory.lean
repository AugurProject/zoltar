import Inv08AuthorityBytes
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.Authority
theorem bindPure {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f)=f v := rfl
theorem liftPure {α : Type} (v : α) : (liftM (Except.ok v : Except RevertData α) : SolI α)=pure v := rfl
theorem selfRead (n : Nat) (c : Context) (r : Runtime) :
    Expr.evalFuel (n+2) c r selfCode.value = pure (.bytes (bytes c r),r) := by
  change Expr.evalFuel _ c r (.envBytesLookup .accountCode .self) = _
  rw [Expr.evalFuel,Expr.evalFuel]
  rfl

theorem sizeRead (c : Context) (r : Runtime) :
    Inv40.Reads c r (length selfCode).value (bytes c r).length := by
  intro fuel h
  change 3≤fuel at h
  obtain ⟨n,rfl⟩ := Nat.exists_eq_add_of_le h
  rw [Nat.add_comm]
  change Expr.evalFuel (n+3) c r (.length selfCode.value) = _
  rw [Expr.evalFuel]
  change (do let (v,s) ← Expr.evalFuel (n+2) c r selfCode.value
             match v with
             | .word w => pure (Value.word w,s)
             | _ => match v.length? with
               | some len => pure (Value.word len,s)
               | none => throw (SolidityFailure.revert RevertData.typeMismatch)) = _
  rw [selfRead]; rfl
  all_goals simp [selfCode]

structure MemoryCode (r : Runtime) (code : List Nat) : Prop where
  pointer : ∃ id, r.lookupLocal? "#extcode" = some (.memoryRef id) ∧ r.loadMemory? id=some (.bytes code)

theorem localBytes (n : Nat) (c : Context) (r : Runtime) (code : List Nat) (m : MemoryCode r code) :
    Expr.evalFuel (n+1) c r (.var "#extcode") = pure (.bytes code,r) := by
  obtain ⟨id,found,load⟩ := m.pointer
  have ref : r.lookupStorageBase? "#extcode"=none := by simp [Runtime.lookupStorageBase?,found]
  rw [Expr.evalFuel,ref,found]
  simp [Runtime.derefMemoryValue,load,liftPure,bindPure]
theorem localSize (c : Context) (r : Runtime) (code : List Nat) (m : MemoryCode r code) :
    Inv40.Reads c r (length (Inv03.Bodies.varP "#extcode")).value code.length := by
  intro fuel h
  change 2≤fuel at h
  obtain ⟨n,rfl⟩ := Nat.exists_eq_add_of_le h
  rw [Nat.add_comm]
  have ref : r.lookupStorageBase? "#extcode"=none := by
    obtain ⟨id,f,_⟩ := m.pointer
    simp [Runtime.lookupStorageBase?,f]
  change Expr.evalFuel (n+2) c r (.length (.var "#extcode")) = _
  rw [Expr.evalFuel,ref,localBytes n c r _ m]; rfl

theorem readByte (c : Context) (r : Runtime) (code : List Nat) (i : Nat)
    (mem : MemoryCode r code) (size : code.length=65) (hi : i<20)
    (off : r.lookupLocal? "offset"=some (.word 45)) (ix : r.lookupLocal? "#extindex"=some (.word i)) :
    Inv40.Reads c r codeByte.value (byteAt code i) := by
  have bound : 45+i<R := lt_trans (by omega : 45+i<65) (by decide)
  have subscript (n : Nat) : Expr.evalFuel (n+2) c r idx.value = pure (.word (45+i),r) :=
    Inv32Eval.binary (n+1) c r .add (by intro h; cases h) (by intro h; cases h) _ _ _ _ _
      (Inv32Guards.readWord _ _ _ _ _ off) (Inv32Guards.readWord _ _ _ _ _ ix) (Inv40.addWords _ _ _ bound)
  have none : r.lookupStorageBase? "#extcode"=Option.none := by
    obtain ⟨id,f,_⟩ := mem.pointer
    simp [Runtime.lookupStorageBase?,f]
  have reading : (Value.bytes code).index? (45+i) = .ok (.word (byteAt code i)) := by
    simp [Value.index?,show Shared.norm (45+i)=45+i from Nat.mod_eq_of_lt bound,byteAt,byteLookup code (45+i) (by omega)]
  intro fuel h
  change 5≤fuel at h
  obtain ⟨n,rfl⟩ := Nat.exists_eq_add_of_le h
  rw [Nat.add_comm]
  have pair : Expr.evalListFuel (n+4) c r [.var "#extcode",idx.value] = pure ([.bytes code,.word (45+i)],r) := by
    rw [Expr.evalListFuel,localBytes (n+2) c r code mem]
    simp only [bindPure]
    rw [Expr.evalListFuel,subscript n]
    simp only [bindPure,Expr.evalListFuel]
  change Expr.evalFuel (n+5) c r (.index (.var "#extcode") idx.value) = _
  rw [Expr.evalFuel]
  simp only [Expr.hasStorageRoot,Expr.hasStorageRefRoot,none,Option.isSome_none,Bool.false_eq_true,if_false,pair,bindPure]
  change (do let a ← liftM (Value.word (45+i)).expectWord
             let v ← liftM ((Value.bytes code).index? a)
             let w ← liftM (r.derefMemoryValue v)
             pure (w,r)) = _
  have castWord : (Value.word (45+i)).expectWord=.ok (45+i) := congrArg (Except.ok (ε:=RevertData)) (Nat.mod_eq_of_lt bound)
  rw [castWord]
  simp only [liftPure,bindPure,reading]
  rfl
end Inv08.Authority
