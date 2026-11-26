import Inv45ByteRead
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Bytes
def overwrite (r : Runtime) (id : Nat) (s : List Nat) := {r with memory:=r.memory.insertLoop id (.bytes s)}
theorem load (r : Runtime) (id : Nat) (s : List Nat) : (overwrite r id s).loadMemory? id=some (.bytes s) := by
  change (r.memory.insert id (.bytes s))[id]?=_;simp
theorem elsewhere (r : Runtime) (id j : Nat) (s : List Nat) (different : j≠id) :
    (overwrite r id s).loadMemory? j=r.loadMemory? j := by
  change (r.memory.insert id (.bytes s))[j]?=r.memory[j]?
  rw [Std.HashMap.getElem?_insert];simp [different.symm]
theorem setIndex (before tail : List Nat) (old new : Nat) :
    listUpdateAt? (before++old::tail) before.length new=some (before++new::tail) := by
  induction before with
  | nil =>rfl
  | cons a as ih =>simp only [List.cons_append,List.length_cons,listUpdateAt?,ih]
theorem normBytes (xs : List Nat) (B : ∀ ch∈xs,ch<256) : xs.map normByte=xs := by
  induction xs with
  | nil => rfl
  | cons a rest ih =>
    have A : normByte a=a := Nat.mod_eq_of_lt (B _ (by simp))
    simp [A,ih (fun x h => B x (by simp [h]))]
def encodedByte (fixed : Bool) (b : Nat) : Value := if fixed then .fixedBytes 1 b else .word b
theorem updated (fixed : Bool) (c : Context) (r : Runtime) (id i byte : Nat) (bs next : List Nat)
    (M : r.loadMemory? id=some (.bytes bs)) (I : i<R) (B : byte<256) (sane : ∀ch∈bs,ch<256)
    (written : listUpdateAt? bs i byte=some next) :
    (ResolvedLValue.valueIndex (.memoryCell id) i).write c r (encodedByte fixed byte)=.ok (overwrite r id next) := by
  have read : (ResolvedLValue.memoryCell id).read c r=.ok (.bytes bs) := by simp [ResolvedLValue.read,ResolvedLValue.readRaw,M,Runtime.derefMemoryValue,Bind.bind,Except.bind]
  have byten : normByte byte=byte := Nat.mod_eq_of_lt B
  have nb : Shared.norm byte=byte := Nat.mod_eq_of_lt (lt_trans B (by decide : 256<R))
  have set : (Value.bytes bs).setIndex? i (encodedByte fixed byte)=.ok (.bytes next) := by
    cases fixed <;> simp only [encodedByte,Bool.false_eq_true,if_false,if_true,Value.setIndex?,Value.asWord?,nb,byten,normBytes bs sane,show Shared.norm i=i from Nat.mod_eq_of_lt I,written]
  cases fixed <;> simp only [encodedByte,Bool.false_eq_true,if_false,if_true] at set ⊢ <;> simp [ResolvedLValue.write,read,Runtime.derefMemoryValue,Runtime.memoryStoreValue,Value.isMemoryObject,
    set,ResolvedLValue.writeContainer,Runtime.storeMemory?,M,Runtime.memoryStoredValue,overwrite,Bind.bind,Except.bind]
theorem resolve {c r name id i index} (loc : r.lookupLocal? name=some (.memoryRef id)) (I : i<R)
    (idx : Inv40.Reads c r index i) :
    (LValue.index (.var name) index).resolveWithRuntime c r=pure (.valueIndex (.memoryCell id) i,r) := by
  have ns : r.lookupStorageBase? name=none := by simp [Runtime.lookupStorageBase?,loc]
  have parent (k : Nat) : Expr.resolveLValueFuel (k+1) c r (.var name)=pure (.local name,r) := by rw [Expr.resolveLValueFuel,ns,loc]
  have E : (Value.word i).expectWord=.ok i := congrArg (Except.ok (ε:=RevertData)) (Nat.mod_eq_of_lt I)
  have read : (ResolvedLValue.local name).readRaw c r=.ok (.memoryRef id) := by simp [ResolvedLValue.readRaw,loc]
  change Expr.resolveLValueFuel ((1+index.orderFuel+1)+1) c r (.index (.var name) index)=_
  rw [Expr.resolveLValueFuel,parent];simp only [Inv08.Authority.bindPure];rw [idx _ (by omega)]
  simp only [Inv08.Authority.bindPure,E,Inv08.Authority.liftPure,read]
theorem assignValue (fixed : Bool) (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name : String) (index rhs : Source.Expr) (id i byte : Nat) (bs next : List Nat)
    (loc : r.lookupLocal? name=some (.memoryRef id)) (I : i<R) (idx : Inv40.Reads c r index i)
    (Rhs : Expr.evalMemoryRefPreserving c r rhs=pure (encodedByte fixed byte,r))
    (M : r.loadMemory? id=some (.bytes bs)) (B : byte<256) (sane : ∀ch∈bs,ch<256) (written : listUpdateAt? bs i byte=some next) :
    Stmt.eval (n+1) t c r (.assign (.index (.var name) index) rhs)=pure (.normal (overwrite r id next)) := by
  have ref : (LValue.index (.var name) index).wantsMemoryRefRhs r=true := by
    simp [LValue.wantsMemoryRefRhs,LValue.toExpr,Expr.hasStorageRoot,Expr.hasStorageRefRoot,Runtime.lookupStorageBase?,loc]
  have resolved := resolve loc I idx
  have write := updated fixed c r id i byte bs next M I B sane written
  rw [Stmt.eval];dsimp only;rw [ref]
  simp only [if_true,Rhs]
  have caught {α : Type} (x : α) : (pure x : SolI α).caught=pure (.ok x) := rfl
  simp only [caught,Inv08.Authority.bindPure,resolved]
  simp [ResolvedLValue.asStoragePath?,write]
abbrev assign := assignValue true
end Inv45.Bytes
