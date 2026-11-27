import Inv45ByteShapes
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Bytes
structure Ref (r : Runtime) (name : String) (id : Nat) (bs : List Nat) : Prop where
  pointer : r.lookupLocal? name=some (.memoryRef id)
  cell : r.loadMemory? id=some (.bytes bs)
theorem val (c : Context) (r : Runtime) (name : String) (id : Nat) (bs : List Nat) (ref : Ref r name id bs) :
    Inv45.Reads c r (.var name) (.bytes bs) := by
  intro fuel enough;cases fuel with
  | zero => change 1≤0 at enough;omega
  | succ n =>
    have ns : r.lookupStorageBase? name=none := by simp [Runtime.lookupStorageBase?,ref.pointer]
    rw [Expr.evalFuel,ns,ref.pointer]
    simp [Runtime.derefMemoryValue,ref.cell,Inv08.Authority.liftPure,Inv08.Authority.bindPure]
theorem length (c : Context) (r : Runtime) (name : String) (id : Nat) (bs : List Nat) (ref : Ref r name id bs) :
    Inv40.Reads c r (Inv08.Authority.length (varP name)).value bs.length := by
  intro fuel enough;change 2≤fuel at enough
  obtain ⟨n,rfl⟩ := Nat.exists_eq_add_of_le enough;rw [Nat.add_comm]
  have ns : r.lookupStorageBase? name=none := by simp [Runtime.lookupStorageBase?,ref.pointer]
  change Expr.evalFuel (n+2) c r (.length (.var name))=_
  rw [Expr.evalFuel];simp only [Expr.hasStorageRoot,Expr.hasStorageRefRoot,ns,Option.isSome_none,Bool.false_eq_true,if_false]
  rw [val c r name id bs ref (n+1) (by change 1≤n+1;omega)];rfl
theorem indexed {xs : List Nat} {i byte : Nat} (sane : ∀ v∈xs, v<256) (word : i<R)
    (atIndex : xs[i]?=some byte) : (Value.bytes xs).index? i=.ok (.word byte) := by
  have get (s : List Nat) (k : Nat) : listGet? s k=s[k]? := by
    induction s generalizing k with
    | nil => rfl
    | cons hd tl ih => cases k with | zero=>rfl | succ k=>exact ih k
  simp only [Value.index?,normBytes xs sane,show Shared.norm i=i from Nat.mod_eq_of_lt word,get,atIndex]
theorem indexPreserved {c r name id bs i byte idx} (ref : Ref r name id bs) (word : i<R)
    (I : Inv40.Reads c r (idx : Pattern Source.Expr).value i) (sane : ∀ v∈bs,v<256) (here : bs[i]?=some byte) :
    Expr.evalMemoryRefPreserving c r (index (varP name) idx).value=pure (.word byte,r) := by
  let e := (index (varP name) idx).value
  have ns : r.lookupStorageBase? name=none := by simp [Runtime.lookupStorageBase?,ref.pointer]
  have W : (Value.word i).expectWord=.ok i := congrArg (Except.ok (ε:=RevertData)) (Nat.mod_eq_of_lt word)
  have byteAt := indexed sane word here
  unfold Expr.evalMemoryRefPreserving Expr.memoryRefOrValue
  change (do let (id?,val?,z) ← Expr.memoryRefOrValueFuel ((1+idx.value.orderFuel+1)+1+1) c r (.index (.var name) idx.value)
             match id?,val? with
             | some k,_=>pure (Value.memoryRef k,z)
             | none,some v=>pure (v,z)
             | none,none=>Expr.eval c z e)=_
  rw [Expr.memoryRefOrValueFuel]
  simp only [Expr.hasStorageRoot,Expr.hasStorageRefRoot,ns,Option.isSome_none,Bool.or_false, Bool.false_eq_true,if_false]
  rw [val c r name id bs ref _ (by change 1≤1+idx.value.orderFuel+1+1;omega)]
  simp only [Inv08.Authority.bindPure,I (1+idx.value.orderFuel+2) (by omega),W,Inv08.Authority.liftPure,byteAt]
  simp [Runtime.derefMemoryValue,Bind.bind,Except.bind,byteAt];rfl
theorem indexedEval {c r name id bs i byte idx} (n : Nat) (ref : Ref r name id bs) (word : i<R)
    (I : Inv40.Reads c r (idx : Pattern Source.Expr).value i) (sane : ∀ v∈bs,v<256) (here : bs[i]?=some byte) :
    Expr.evalFuel (n+idx.value.orderFuel+4) c r (index (varP name) idx).value=pure (.word byte,r) := by
  let f := n+idx.value.orderFuel
  have ns : r.lookupStorageBase? name=none := by simp [Runtime.lookupStorageBase?,ref.pointer]
  have W : (Value.word i).expectWord=.ok i := congrArg (Except.ok (ε:=RevertData)) (Nat.mod_eq_of_lt word)
  have V := indexed sane word here
  have pair : Expr.evalListFuel (f+3) c r [.var name,idx.value]=pure ([.bytes bs,.word i],r) := by
    rw [Expr.evalListFuel,val c r name id bs ref (f+2) (by change 1≤f+2;omega)]
    simp only [Inv08.Authority.bindPure]
    rw [Expr.evalListFuel,I _ (by dsimp [f];omega)]
    simp only [Inv08.Authority.bindPure,Expr.evalListFuel]
  change Expr.evalFuel (f+4) c r (.index (.var name) idx.value)=_
  rw [Expr.evalFuel];simp only [Expr.hasStorageRoot,Expr.hasStorageRefRoot,ns,Option.isSome_none,Bool.false_eq_true,if_false,pair,Inv08.Authority.bindPure]
  change (do let key ← liftM (Value.word i).expectWord
             let value ← liftM ((Value.bytes bs).index? key)
             let result ← liftM (r.derefMemoryValue value)
             pure (result,r))=_
  rw [W];simp only [Inv08.Authority.liftPure,Inv08.Authority.bindPure,V];rfl
end Inv45.Bytes
