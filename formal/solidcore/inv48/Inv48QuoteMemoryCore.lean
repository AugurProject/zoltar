import Inv48QuoteExecCore
import Inv08MemoryMember
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

def tuple (a b h e s : Nat) : Value := .tuple [.word a,.word b,.word h,.word e,.word s]
def put (r : Runtime) (id a b h e s : Nat) : Runtime :=
  {r with memory := MemoryMap.insertLoop r.memory id (tuple a b h e s)}

private theorem bindOk {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl
private theorem liftOk {α : Type} (v : α) : (liftM (Except.ok v : Except RevertData α) : SolI α) = pure v := rfl

theorem put_local (r : Runtime) (id a b h e s : Nat) (name : String) :
    (put r id a b h e s).lookupLocal? name = r.lookupLocal? name := rfl

theorem put_load (r : Runtime) (id a b h e s : Nat) :
    (put r id a b h e s).loadMemory? id = some (tuple a b h e s) := by
  simp [put,Runtime.loadMemory?,MemoryMap.lookup?,MemoryMap.insertLoop]

theorem resolve (c : Context) (r : Runtime) (id i : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id)) (fit : i<R) :
    (LValue.index (.var "quote") (.word i)).resolveWithRuntime c r =
      pure (.valueIndex (.memoryCell id) i,r) := by
  have noBase : r.lookupStorageBase? "quote" = none := by simp [Runtime.lookupStorageBase?,ref]
  have norm : SolidCore.Solidity.Shared.norm i = i := Nat.mod_eq_of_lt fit
  simp [LValue.resolveWithRuntime,LValue.toExpr,Expr.resolveLValue,Expr.orderFuel,
    Expr.resolveLValueFuel,noBase,ref,Expr.evalFuel,normWord,norm,
    ResolvedLValue.readRaw,Value.expectWord,liftOk,bindOk]

-- A scalar word write cannot allocate or modify any field of the runtime except memory.
theorem write0 (c : Context) (r : Runtime) (id a b h e s v : Nat)
    (mem : r.loadMemory? id = some (tuple a b h e s)) :
    (ResolvedLValue.valueIndex (.memoryCell id) 0).write c r (.word v) =
      .ok (put r id v b h e s) := by
  simp [ResolvedLValue.write,ResolvedLValue.read,ResolvedLValue.readRaw,mem,
    Runtime.derefMemoryValue,Runtime.memoryStoreValue,Value.setIndex?,tuple,
    Bind.bind,Except.bind,listUpdateAt?,ResolvedLValue.writeContainer,Runtime.storeMemory?,
    Runtime.memoryStoredValue,Runtime.memoryStoredValues,Value.isMemoryObject,put,
    SolidCore.Solidity.Shared.norm,SolidCore.Solidity.Shared.wordModulus,EvmYul.UInt256.size]

theorem write1 (c : Context) (r : Runtime) (id a b h e s v : Nat)
    (mem : r.loadMemory? id = some (tuple a b h e s)) :
    (ResolvedLValue.valueIndex (.memoryCell id) 1).write c r (.word v) =
      .ok (put r id a v h e s) := by
  simp [ResolvedLValue.write,ResolvedLValue.read,ResolvedLValue.readRaw,mem,
    Runtime.derefMemoryValue,Runtime.memoryStoreValue,Value.setIndex?,tuple,
    Bind.bind,Except.bind,listUpdateAt?,ResolvedLValue.writeContainer,Runtime.storeMemory?,
    Runtime.memoryStoredValue,Runtime.memoryStoredValues,Value.isMemoryObject,put,
    SolidCore.Solidity.Shared.norm,SolidCore.Solidity.Shared.wordModulus,EvmYul.UInt256.size]

theorem write2 (c : Context) (r : Runtime) (id a b h e s v : Nat)
    (mem : r.loadMemory? id = some (tuple a b h e s)) :
    (ResolvedLValue.valueIndex (.memoryCell id) 2).write c r (.word v) =
      .ok (put r id a b v e s) := by
  simp [ResolvedLValue.write,ResolvedLValue.read,ResolvedLValue.readRaw,mem,
    Runtime.derefMemoryValue,Runtime.memoryStoreValue,Value.setIndex?,tuple,
    Bind.bind,Except.bind,listUpdateAt?,ResolvedLValue.writeContainer,Runtime.storeMemory?,
    Runtime.memoryStoredValue,Runtime.memoryStoredValues,Value.isMemoryObject,put,
    SolidCore.Solidity.Shared.norm,SolidCore.Solidity.Shared.wordModulus,EvmYul.UInt256.size]

theorem write3 (c : Context) (r : Runtime) (id a b h e s v : Nat)
    (mem : r.loadMemory? id = some (tuple a b h e s)) :
    (ResolvedLValue.valueIndex (.memoryCell id) 3).write c r (.word v) =
      .ok (put r id a b h v s) := by
  simp [ResolvedLValue.write,ResolvedLValue.read,ResolvedLValue.readRaw,mem,
    Runtime.derefMemoryValue,Runtime.memoryStoreValue,Value.setIndex?,tuple,
    Bind.bind,Except.bind,listUpdateAt?,ResolvedLValue.writeContainer,Runtime.storeMemory?,
    Runtime.memoryStoredValue,Runtime.memoryStoredValues,Value.isMemoryObject,put,
    SolidCore.Solidity.Shared.norm,SolidCore.Solidity.Shared.wordModulus,EvmYul.UInt256.size]

theorem write4 (c : Context) (r : Runtime) (id a b h e s v : Nat)
    (mem : r.loadMemory? id = some (tuple a b h e s)) :
    (ResolvedLValue.valueIndex (.memoryCell id) 4).write c r (.word v) =
      .ok (put r id a b h e v) := by
  simp [ResolvedLValue.write,ResolvedLValue.read,ResolvedLValue.readRaw,mem,
    Runtime.derefMemoryValue,Runtime.memoryStoreValue,Value.setIndex?,tuple,
    Bind.bind,Except.bind,listUpdateAt?,ResolvedLValue.writeContainer,Runtime.storeMemory?,
    Runtime.memoryStoredValue,Runtime.memoryStoredValues,Value.isMemoryObject,put,
    SolidCore.Solidity.Shared.norm,SolidCore.Solidity.Shared.wordModulus,EvmYul.UInt256.size]

/-- All actual field RHSs are casts; these use ordinary scalar evaluation even
though the indexed target selects the memory-reference-preserving entry point. -/
theorem castRhs (c : Context) (r : Runtime) (k : CastKind) (w : Nat) (e : Expr) (v : Nat)
    (rhs : Expr.eval c r (.castOp k w e) = pure (.word v,r)) :
    Expr.evalMemoryRefPreserving c r (.castOp k w e) = pure (.word v,r) := by
  unfold Expr.evalMemoryRefPreserving Expr.memoryRefOrValue
  simp only [Expr.orderFuel,Expr.memoryRefOrValueFuel]
  change Expr.evalFuel (e.orderFuel+1+1) c r (.castOp k w e) = _ at rhs
  rw [rhs]
  rfl

/-- Operational indexed assignment; only scalar RHS evaluation is assumed. -/
theorem assign (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime)
    (id i v : Nat) (k : CastKind) (w : Nat) (e : Expr)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id)) (fit : i<R)
    (rhs : Expr.eval c r (.castOp k w e) = pure (.word v,r))
    (write : (ResolvedLValue.valueIndex (.memoryCell id) i).write c r (.word v) = .ok next) :
    Stmt.eval (n+1) t c r (.assign (.index (.var "quote") (.word i)) (.castOp k w e)) =
      pure (.normal next) := by
  have noBase : r.lookupStorageBase? "quote" = none := by simp [Runtime.lookupStorageBase?,ref]
  have wants : (LValue.index (.var "quote") (.word i)).wantsMemoryRefRhs r = true := by
    simp [LValue.wantsMemoryRefRhs,LValue.toExpr,Expr.hasStorageRoot,Expr.hasStorageRefRoot,noBase]
  rw [Stmt.eval]
  dsimp only
  rw [wants]
  simp only [if_true,castRhs c r k w e v rhs]
  change (do
    match ← ((LValue.index (.var "quote") (.word i)).resolveWithRuntime c r).caught with
    | .ok (target,rt) => match target.write c rt (.word v) with
      | .ok updated => pure (Result.normal updated)
      | .error err => pure (Result.reverted r err)
    | .error err => pure (Result.reverted r err)) = _
  rw [resolve c r id i ref fit]
  change (match (ResolvedLValue.valueIndex (.memoryCell id) i).write c r (.word v) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (Result.reverted r err)) = _
  rw [write]

#print axioms write0
#print axioms write1
#print axioms write2
#print axioms write3
#print axioms write4
#print axioms assign
end Inv48.QuoteMemory
