import Inv39UniversalGenesisFacts
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.UniversalGenesis.Symbolic
set_option maxRecDepth 20000
set_option maxHeartbeats 0
set_option linter.unusedSimpArgs false
def body : Source.Stmt := (Stmt.block
  [Stmt.skip,
   Stmt.skip,
   Stmt.skip,
   Stmt.skip,
   Stmt.skip,
   Stmt.skip,
   Stmt.skip,
   Stmt.skip,
   Stmt.skip,
   Stmt.skip,
   Stmt.skip,
   Stmt.skip,
   Stmt.skip,
   Stmt.skip,
   Stmt.skip,
   Stmt.block
     [Stmt.block
        [Stmt.block
           [Stmt.block
              [Stmt.memoryVarDecl
                 (Ty.bytesCalldata)
                 "#solidcore_base_arg_eval_0"
                 none,
               Stmt.assign
                 (LValue.var "#solidcore_base_arg_eval_0")
                 (Expr.byteArray [82, 101, 112, 117, 116, 97, 116, 105, 111, 110]),
               Stmt.memoryVarDecl
                 (Ty.bytesCalldata)
                 "name_"
                 (some (Expr.var "#solidcore_base_arg_eval_0")),
               Stmt.memoryVarDecl
                 (Ty.bytesCalldata)
                 "#solidcore_base_arg_eval_1"
                 none,
               Stmt.assign
                 (LValue.var "#solidcore_base_arg_eval_1")
                 (Expr.byteArray [82, 69, 80]),
               Stmt.memoryVarDecl
                 (Ty.bytesCalldata)
                 "symbol_"
                 (some (Expr.var "#solidcore_base_arg_eval_1")),
               Stmt.block
                 [Stmt.block [Stmt.block []]],
               Stmt.block
                 [Stmt.assign
                    (LValue.storage "_name")
                    (Expr.var "name_"),
                  Stmt.assign
                    (LValue.storage "_symbol")
                    (Expr.var "symbol_")]]]]],
   Stmt.skip,
   Stmt.block
     [Stmt.requireStmt
        (Expr.binary
          (BinaryOp.ne)
          (Expr.var "_zoltar")
          (Expr.word 0))
        (some "Zoltar must not be the zero address"),
      Stmt.assign
        (LValue.immutable "zoltar")
        (Expr.var "_zoltar")]])
def context (c : Context) := { c with
  storageFields := [Init.field .name,Init.field .symbol]
  immutableFields := [⟨"zoltar",.address⟩]
  checked := true
  construction := true
  memoryAllocationLimit? := none }
def freshMetadata (balance : Nat) : State :=
  ({State.empty with selfBalance:=balance}.storeStorageBytesAt 3
    [82,101,112,117,116,97,116,105,111,110]).storeStorageBytesAt 4 [82,69,80]
theorem caughtPure {α : Type} (v : α) : (pure v : SolI α).caught = pure (.ok v) := rfl
theorem exceptPure {α β ε : Type} (v : α) (f : α → Except ε β) : (Except.ok v >>= f)=f v := rfl
theorem exceptMap {α β ε : Type} (v : α) (f : α → β) : f <$> (Except.ok v : Except ε α)=Except.ok (f v) := rfl
theorem run (t : FunctionTable) (c : Context) (owner balance : Nat) (nonzero : Shared.norm owner ≠ 0)
    (nameField : c.storageField? "_name"=some (Init.field .name))
    (symbolField : c.storageField? "_symbol"=some (Init.field .symbol))
    (immutableField : c.immutableField? "zoltar"=some ⟨"zoltar",.address⟩)
    (construction : c.construction=true) :
    ∃ dst, Stmt.eval 50000 t c
      {state:={State.empty with selfBalance:=balance},locals:=[[("_zoltar",.word owner)]]} body = pure (.normal dst) ∧
      dst.state=((freshMetadata balance).storeImmutable "zoltar" (.word owner)) := by
  have normZero : Shared.norm 0=0 := rfl
  have normOne : Shared.norm 1=1 := rfl
  have wordZero : normWord 0=0 := rfl
  simp [body,Stmt.eval,Stmt.evalList,Expr.eval,Expr.evalFuel,
    Inv08.Authority.bindPure,Inv08.Authority.liftPure,caughtPure,Result.mapRuntime,
    Runtime.declareMemoryLocal,Ty.coerceValue?,Ty.defaultValue,Runtime.memoryStoredValue,
    Runtime.allocMemory,Runtime.declareLocal,Runtime.pushScope,Runtime.popScope,
    LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,
    Runtime.loadMemory?,MemoryMap.lookup?,MemoryMap.insertLoop,
    Runtime.derefMemoryValue,Value.memoryAllocationBytes,
    LValue.wantsMemoryRefRhs,Runtime.lookupMemoryRef?,Expr.evalMemoryRefPreserving,
    Expr.memoryRefOrValue,LValue.resolveWithRuntime,LValue.toExpr,Expr.resolveLValue,
    Expr.resolveLValueFuel,Runtime.lookupStorageBase?,ResolvedLValue.write,
    Runtime.assignLocal?,Runtime.assignLocalRaw?,Runtime.storeMemory?,
    Frame.assign?,LocalEnv.assign?,Runtime.assignStorageRefValue?,Value.coerceLike?,
    Expr.memoryRefOrValueFuel,Expr.orderFuel,normByte,Value.isMemoryObject,
    Runtime.storeStorageFieldWithDeepClear,Runtime.storeStorageField,
    Runtime.storageMaterializedValue,Runtime.derefMemoryValueDeep,
    Runtime.derefMemoryValueWithFuel,Runtime.storeImmutableField,
    nameField,symbolField,immutableField,construction,Init.field,Init.name,Init.slot,
    Init.kind,Init.scalar,Inv08.Authority.liftPure,
    Std.HashMap.getElem_insert,Std.HashMap.getElem?_insert,
    Std.HashMap.getElem?_empty,exceptPure,exceptMap,
    BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,
    Value.expectWord,wordTruthy,boolWord,wordEq,nonzero,normZero,normOne,wordZero,Shared.Account.byte]
  exact ⟨_,rfl,rfl⟩
#print axioms run
end Inv39.UniversalGenesis.Symbolic
