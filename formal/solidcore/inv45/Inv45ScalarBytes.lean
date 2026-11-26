import Inv45ScalarShape
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Scalar
open Bytes
theorem packResult {c r xs bs} (parts : ByteParts c r xs bs) :
    Expr.memoryRefOrValue c r (pack xs).value=pure (none,some (.bytes bs.flatten),r) := by
  unfold Expr.memoryRefOrValue
  change Expr.memoryRefOrValueFuel (_+1) c r (.encode .packed none _ _ (seq xs).value)=_
  rw [Expr.memoryRefOrValueFuel.eq_def];dsimp only
  change (do let (v,s) ← Expr.evalFuel ((pack xs).value.orderFuel+1) c r (pack xs).value
             pure (none,some v,s))=_
  rw [packedRead parts _ (by omega)];rfl
theorem assignPack {c r xs bs} (fuel : Nat) (t : FunctionTable) (name : String) (old : Nat) (next : Runtime)
    (parts : ByteParts c r xs bs) (target : r.lookupLocal? name=some (.memoryRef old))
    (raw : (allocate r bs.flatten).assignLocalRaw? name (.memoryRef r.nextMemory)=some next) :
    Stmt.eval (fuel+1) t c r (Inv03.Bodies.assign name (pack xs)).value=pure (.normal next) := by
  have ref : r.lookupMemoryRef? name=some old := by simp [Runtime.lookupMemoryRef?,target]
  have ns : r.lookupStorageBase? name=none := by simp [Runtime.lookupStorageBase?,target]
  have read : Expr.evalMemoryRefPreserving c r (pack xs).value=pure (.bytes bs.flatten,r) := by
    unfold Expr.evalMemoryRefPreserving;rw [packResult parts];rfl
  have place : (LValue.var name).resolveWithRuntime c r=pure (.local name,r) := by
    change Expr.resolveLValueFuel 2 c r (.var name)=_;rw [Expr.resolveLValueFuel,ns,target]
  have write : (ResolvedLValue.local name).write c r (.bytes bs.flatten)=.ok next := by
    simp only [ResolvedLValue.write,Runtime.assignLocal?,target,Value.isMemoryObject,if_true,Runtime.memoryStoredValue,Runtime.allocMemory]
    change (match (allocate r bs.flatten).assignLocalRaw? name (.memoryRef r.nextMemory) with
      | some s=>Except.ok s|none=>.error RevertData.typeMismatch)=_
    rw [raw]
  change Stmt.eval _ _ _ _ (.assign (.var name) (.encode .packed none _ _ (seq xs).value))=_
  rw [Stmt.eval];dsimp only
  simp only [LValue.wantsMemoryRefRhs,ref,Option.isSome_some,if_true]
  change (do match ← (Expr.evalMemoryRefPreserving c r (pack xs).value).caught with
    | .ok (v,s)=>do match ← ((LValue.var name).resolveWithRuntime c s).caught with
                          | .ok (dst,u)=>match dst.write c u v with | .ok z=>pure (Result.normal z) | .error e=>pure (Result.reverted r e)
                          | .error e=>pure (Result.reverted r e)
    | .error e=>pure (Result.reverted r e))=_
  rw [read]
  change (do match ← ((LValue.var name).resolveWithRuntime c r).caught with
    | .ok (dst,u)=>match dst.write c u (.bytes bs.flatten) with | .ok z=>pure (Result.normal z) | .error e=>pure (Result.reverted r e)
    | .error e=>pure (Result.reverted r e))=_
  rw [place]
  change (match (ResolvedLValue.local name).write c r (.bytes bs.flatten) with
    | .ok z=>(pure (.normal z) : SolI Result) | .error e=>pure (.reverted r e))=_
  rw [write]
theorem textInit (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name : String) (bs : List Nat)
    (sane : ∀v∈bs,v<256) :
    Stmt.eval (fuel+1) t c r (textBytes name bs).value=
      pure (.normal ((allocate r bs).declareLocal name (.memoryRef r.nextMemory))) := by
  have ref : Expr.memoryRefOrValue c r (Decimal.bytesLiteral bs).value=pure (none,some (.bytes bs),r) := by
    change Expr.memoryRefOrValueFuel 3 c r (.byteArray bs)=_
    rw [Expr.memoryRefOrValueFuel.eq_def];dsimp only
    have E := literalBytes c r bs sane 2 (by change 1≤2;decide)
    change Expr.evalFuel 2 c r (.byteArray bs)=_ at E
    rw [E];rfl
  have decl : r.declareMemoryLocal .bytesCalldata name (.bytes bs)=some ((allocate r bs).declareLocal name (.memoryRef r.nextMemory)) := by
    simp [Runtime.declareMemoryLocal,Ty.coerceValue?,Runtime.allocMemory,Runtime.memoryStoredValue,allocate]
  change Stmt.eval _ _ _ _ (.memoryVarDecl .bytesCalldata name (some (Decimal.bytesLiteral bs).value))=_
  rw [Stmt.eval];dsimp only;rw [ref]
  change (match r.declareMemoryLocal .bytesCalldata name (.bytes bs) with
    | some updated=>(pure (.normal updated) : SolI Result) | none=>pure (.reverted r RevertData.typeMismatch))=_
  rw [decl]
end Inv45.Scalar
