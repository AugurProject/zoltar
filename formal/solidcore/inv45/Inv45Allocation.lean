import Inv45ByteStore
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Bytes
def allocate (r : Runtime) (bs : List Nat) : Runtime :=
  {r with
    memory:=r.memory.insertLoop r.nextMemory (.bytes bs)
    nextMemory:=r.nextMemory+1
    nextMemoryByte:=r.nextMemoryByte+(Value.bytes bs).memoryAllocationBytes}
def ReadsBytes (r : Runtime) (v : Value) (bs : List Nat) := r.derefMemoryValue v=.ok (.bytes bs)
structure Retains (r s : Runtime) : Prop where
  state : s.state=r.state
  next : r.nextMemory≤s.nextMemory
  memory : ∀id, id<r.nextMemory → s.loadMemory? id=r.loadMemory? id
theorem unchanged (r : Runtime) : Retains r r := ⟨rfl,le_rfl,fun _ _=>rfl⟩
theorem trans {r s t : Runtime} (X : Retains r s) (Y : Retains s t) : Retains r t :=
  ⟨Y.state.trans X.state,le_trans X.next Y.next,fun i h=>(Y.memory i (lt_of_lt_of_le h X.next)).trans (X.memory _ h)⟩
theorem allocated (r : Runtime) (bs : List Nat) : Retains r (allocate r bs) := by
  refine ⟨rfl,Nat.le_succ _,?_⟩
  intro i less;exact elsewhere r r.nextMemory i bs (Nat.ne_of_lt less)
theorem newBytes (c : Context) (r : Runtime) (name : String) (size : Nat) (digit : r.lookupLocal? name=some (.word size))
    (small : size≤78) (cap : c.memoryAllocationLimit?=none) :
    Expr.eval c r (Decimal.allocBytes name).value=pure (.bytes (List.replicate size 0),r) := by
  have word : size<R := lt_of_le_of_lt small (by decide)
  have norm : Shared.norm size=size := Nat.mod_eq_of_lt word
  have expect : (Value.word size).expectWord=.ok size := congrArg (Except.ok (ε:=RevertData)) norm
  have ok : c.checkMemoryAllocation size=.ok size := by
    simp [Context.checkMemoryAllocation,norm,cap,show ¬ size>0xffffffffffffffff by omega]
  change Expr.evalFuel 3 c r (.newBytes (.var name))=_
  rw [Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ digit]
  simp only [Inv08.Authority.bindPure,Inv08.Authority.liftPure,expect,ok]
theorem allocateBytes (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (dest lengthName : String) (size : Nat)
    (digits : r.lookupLocal? lengthName=some (.word size)) (small : size≤78) (cap : c.memoryAllocationLimit?=none) :
    Stmt.eval (n+1) t c r (Decimal.mem dest (Option_some (Decimal.allocBytes lengthName))).value =
      pure (.normal ((allocate r (List.replicate size 0)).declareLocal dest (.memoryRef r.nextMemory))) := by
  let bs : List Nat := List.replicate size 0
  have expr := newBytes c r _ _ digits small cap
  have ref : Expr.memoryRefOrValue c r (Decimal.allocBytes lengthName).value=pure (none,some (.bytes bs),r) := by
    change Expr.memoryRefOrValueFuel 4 c r (.newBytes (.var lengthName))=_
    rw [Expr.memoryRefOrValueFuel.eq_def];dsimp only
    change Expr.evalFuel 3 c r (.newBytes (.var lengthName))=_ at expr
    rw [expr];rfl
  have declared : r.declareMemoryLocal .bytesCalldata dest (.bytes bs)=some ((allocate r bs).declareLocal dest (.memoryRef r.nextMemory)) := by
    simp only [Runtime.declareMemoryLocal,Ty.coerceValue?,Runtime.memoryStoredValue,Runtime.allocMemory,allocate,
      Option.bind_some,Option.pure_def];rfl
  change Stmt.eval (n+1) t c r (.memoryVarDecl .bytesCalldata dest (some (Decimal.allocBytes lengthName).value))=_
  rw [Stmt.eval];dsimp only;rw [ref]
  change (match r.declareMemoryLocal .bytesCalldata dest (.bytes bs) with
    | some updated=>(pure (.normal updated) : SolI Result)
    | none=>pure (.reverted r RevertData.typeMismatch))=_
  rw [declared]
theorem buffer (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (size : Nat)
    (digits : r.lookupLocal? "digits"=some (.word size)) (small : size≤78) (cap : c.memoryAllocationLimit?=none) :
    Stmt.eval (n+1) t c r (Decimal.mem "buffer" (Option_some (Decimal.allocBytes "digits"))).value =
      pure (.normal ((allocate r (List.replicate size 0)).declareLocal "buffer" (.memoryRef r.nextMemory))) := by
  let bs : List Nat := List.replicate size 0
  have expr := newBytes c r _ _ digits small cap
  have ref : Expr.memoryRefOrValue c r (Decimal.allocBytes "digits").value=pure (none,some (.bytes bs),r) := by
    change Expr.memoryRefOrValueFuel 4 c r (.newBytes (.var "digits"))=_
    rw [Expr.memoryRefOrValueFuel.eq_def];dsimp only
    change Expr.evalFuel 3 c r (.newBytes (.var "digits"))=_ at expr
    rw [expr];rfl
  have declared : r.declareMemoryLocal .bytesCalldata "buffer" (.bytes bs)=some ((allocate r bs).declareLocal "buffer" (.memoryRef r.nextMemory)) := by
    simp only [Runtime.declareMemoryLocal,Ty.coerceValue?,Runtime.memoryStoredValue,Runtime.allocMemory,allocate,
      Option.bind_some,Option.pure_def];rfl
  change Stmt.eval (n+1) t c r (.memoryVarDecl .bytesCalldata "buffer" (some (Decimal.allocBytes "digits").value))=_
  rw [Stmt.eval];dsimp only;rw [ref]
  change (match r.declareMemoryLocal .bytesCalldata "buffer" (.bytes bs) with
    | some updated=>(pure (.normal updated) : SolI Result)
    | none=>pure (.reverted r RevertData.typeMismatch))=_
  rw [declared]
end Inv45.Bytes
