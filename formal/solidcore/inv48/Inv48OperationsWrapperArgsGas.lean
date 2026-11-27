import Inv48OperationsWrapperArgsSource
import Inv48MinimaAdd
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Scalar Inv32Actions
namespace Inv48.OperationsWrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

def callbackFormula : Formula := cast .cleanup 256 (cast .cleanup 256
  (binary .add (by intro h; cases h) (by intro h; cases h)
    (cast .cleanup 256 (cast .uint 256 (localWord "_sol_hoist_0")))
    (cast .cleanup 256 (localWord "_sol_hoist_1"))))

theorem actualCallback : callbackP.value =
    .varDecl .uint256 "callbackGas" (some callbackFormula.core) := by rfl

theorem callbackExpression (c : Context) (r : Runtime) (g : Nat)
    (checked : c.checked = true) (hg : g < 2^32)
    (getter : r.lookupLocal? "_sol_hoist_0" = some (.word 4000000))
    (batch : r.lookupLocal? "_sol_hoist_1" = some (.word g)) :
    Expr.eval c r callbackFormula.core = pure (.word (4000000+g),r) := by
  have hw : g < 2^256 := hg.trans_le (by decide)
  have hs : 4000000+g < 2^256 := by omega
  have castW : uintCast? 256 (.word 4000000) = .ok (.word 4000000) := by rfl
  have cg := Inv48.EscrowEntry.cleanWidth true 256 g (by decide) (by decide) hw hw
  have cs := Inv48.EscrowEntry.cleanWidth true 256 (4000000+g) (by decide) (by decide) hs hs
  have cc := Inv48.EscrowEntry.cleanWidth true 256 4000000 (by decide) (by decide) (by decide) (by decide)
  have add : BinaryOp.apply true .add (.word 4000000) (.word g) = .ok (.word (4000000+g)) := by
    have V : BinaryOp.applyWord true .add 4000000 g = .ok (4000000+g) := by
      have h := Inv32Rounding.addition 4000000 g (by decide) hw
      rw [if_pos hs] at h
      cases z : BinaryOp.applyWord true .add 4000000 g <;> simp_all [Except.toOption]
    simp [BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,V,Bind.bind,Except.bind]
  apply evalFormula callbackFormula c r (4000000+g)
  · simp [callbackFormula,Inv32Scalar.cast,binary,localWord,Expr.orderFuel]
  · simp [callbackFormula,Inv32Scalar.cast,binary,localWord,locals,checked,getter,batch,castW,cg,cs,cc,add,projectWord]

theorem callbackDeclaration (n : Nat) (c : Context) (r : Runtime) (g : Nat)
    (checked : c.checked = true) (hg : g < 2^32)
    (getter : r.lookupLocal? "_sol_hoist_0" = some (.word 4000000))
    (batch : r.lookupLocal? "_sol_hoist_1" = some (.word g)) :
    Stmt.eval (n+1) Inv48.Source.model.core.table c r callbackP.value =
      pure (.normal (r.declareLocal "callbackGas" (.word (4000000+g)))) := by
  rw [actualCallback]
  exact Inv48.PositiveHoist.declEval n Inv48.Source.model.core.table c r "callbackGas" .uint256
    callbackFormula.core (4000000+g) (callbackExpression c r g checked hg getter batch) rfl

theorem checkedTotalFits (g : Nat) (limit : 4000000+g ≤ 10000000) :
    (4000000+g) % 2^32 = 4000000+g :=
  Inv48.WrapperArgs.callbackFits 4000000 g limit
end Inv48.OperationsWrapperArgs
