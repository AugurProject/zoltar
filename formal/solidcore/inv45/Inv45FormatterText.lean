import Inv45DecimalHoist
import Inv45PadHoist
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Format
open Bytes
theorem encodedReturn {c r xs bs} (n : Nat) (t : FunctionTable) (parts : ByteParts c r xs bs) :
    Stmt.eval (n+1) t c r (ret (pack xs)).value=pure (.returned r [.bytes bs.flatten]) := by
  have E : Expr.evalReturnValue c r (pack xs).value=pure (.bytes bs.flatten,r) := packedRead parts _ (by omega)
  have list : Expr.evalReturnList c r [(pack xs).value]=pure ([.bytes bs.flatten],r) := by
    change Expr.evalReturnListFuel (_+1+1) c r [(pack xs).value]=_
    simp only [Expr.evalReturnListFuel,E,Inv08.Authority.bindPure]
  change Stmt.eval _ _ _ _ (.returnValues [(pack xs).value])=_
  rw [Stmt.eval];dsimp only;rw [list];rfl
theorem signReturn (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name : String)
    (signBit : Bool) (bs : List Nat) (id : Nat) (bytes : Ref r name id bs) (bound : id<r.nextMemory)
    (sane : ∀v∈bs,v<256) (negative : r.lookupLocal? "isNegative"=some (.word (if signBit then 1 else 0))) :
    ∃v, Decimal.Holds r (if signBit then 45::bs else bs) v ∧ Stmt.eval (fuel+2) t c r (sign name).value=pure (.returned r [v]) := by
  have test := Inv08.localReads c r "isNegative" _ negative
  have branch := Inv32Blocks.branch (fuel+1) t c r (.var "isNegative") (ret (pack [Decimal.bytesLiteral [45],varP name])).value
    (ret (varP name)).value signBit (test _ (by decide))
  cases signBit with
  | false => exact ⟨.memoryRef id,.ref bound bytes.cell,branch.trans (retRef fuel t c r name id bytes.pointer)⟩
  | true =>
    have parts : ByteParts c r [Decimal.bytesLiteral [45],varP name] [[45],bs] :=
      .cons (literalBytes c r _ (by decide)) (by decide) (.cons (val c r name id bs bytes) sane .nil)
    refine ⟨.bytes (45::bs),.direct,branch.trans ?_⟩
    simpa using encodedReturn fuel t parts
theorem preparePacked {c r xs bs} (n : Nat) (t : FunctionTable) (name : String) (parts : ByteParts c r xs bs) :
    Stmt.eval (n+1) t c r (Decimal.mem name (Option_some (pack xs))).value=
      pure (.normal ((allocate r bs.flatten).declareLocal name (.memoryRef r.nextMemory))) := by
  have ref : Expr.memoryRefOrValue c r (pack xs).value=pure (none,some (.bytes bs.flatten),r) := by
    unfold Expr.memoryRefOrValue
    change Expr.memoryRefOrValueFuel (_+1) c r (.encode .packed none _ _ (seq xs).value)=_
    rw [Expr.memoryRefOrValueFuel.eq_def];dsimp only
    change (do let (v,s) ← Expr.evalFuel ((pack xs).value.orderFuel+1) c r (pack xs).value
               pure (none,some v,s))=_
    rw [packedRead parts _ (by omega)];rfl
  have decl : r.declareMemoryLocal .bytesCalldata name (.bytes bs.flatten)=some ((allocate r bs.flatten).declareLocal name (.memoryRef r.nextMemory)) := by
    simp [Runtime.declareMemoryLocal,Ty.coerceValue?,Runtime.allocMemory,Runtime.memoryStoredValue,allocate]
  change Stmt.eval _ _ _ _ (.memoryVarDecl .bytesCalldata name (some (pack xs).value))=_
  rw [Stmt.eval];dsimp only;rw [ref]
  change (match r.declareMemoryLocal .bytesCalldata name (.bytes bs.flatten) with
    | some updated=>(pure (.normal updated) : SolI Result) | none=>pure (.reverted r RevertData.typeMismatch))=_
  rw [decl]
end Inv45.Format
