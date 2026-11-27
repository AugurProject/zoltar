import Inv48EscrowWire
import Inv32Guards
open SolidCore.Solidity.Source
namespace Inv48.EscrowTrace
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

def calldataExpr : Expr := .encode .withSelector (some (.word 599290589)) []
  [.address,.address,.uint256]
  [.var "payer",.var "escrow",.castOp .uintCast 256 (.var "repAmount")]

def calldata (payer escrow amount : Nat) :=
  wordToBytesBE selectorBytes 599290589 ++ Inv48.Escrow.payload payer escrow amount

private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

 theorem encodeExecution (c : Context) (r : Runtime) (payer escrow amount : Nat)
    (P : r.lookupLocal? "payer" = some (.word payer))
    (E : r.lookupLocal? "escrow" = some (.word escrow))
    (A : r.lookupLocal? "repAmount" = some (.word amount))
    (hp : payer < 2^160) (he : escrow < 2^160) (ha : amount < 2^256) :
    Expr.eval c r calldataExpr = pure (.bytes (calldata payer escrow amount),r) := by
  have ha' : amount < 115792089237316195423570985008687907853269984665640564039457584007913129639936 := ha
  have cast : uintCast? 256 (.word amount) = .ok (.word amount) := by
    simp [uintCast?,Value.forceAbiLazy,Value.asStorageWord?,Nat.mod_eq_of_lt ha',
      SolidCore.Solidity.Shared.norm,SolidCore.Solidity.Shared.wordModulus,EvmYul.UInt256.size,Bind.bind,Except.bind]
  have a (n : Nat) : Expr.evalFuel (n+2) c r (.castOp .uintCast 256 (.var "repAmount")) =
      pure (.word amount,r) := by
    rw [Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ A]
    simp only [pb,cast]
    rfl
  have enc := Inv48.Escrow.transferArguments payer escrow amount hp he
  have args (n : Nat) : Expr.evalListFuel (n+6) c r
      [.word 599290589,.var "payer",.var "escrow",.castOp .uintCast 256 (.var "repAmount")] =
      pure ([.word 599290589,.word payer,.word escrow,.word amount],r) := by
    rw [Expr.evalListFuel,Expr.evalFuel]
    simp only [pb]
    rw [Expr.evalListFuel,Inv32Guards.readWord _ _ _ _ _ P]
    simp only [pb]
    rw [Expr.evalListFuel,Inv32Guards.readWord _ _ _ _ _ E]
    simp only [pb]
    rw [Expr.evalListFuel,a]
    simp only [pb]
    rw [Expr.evalListFuel]
    rfl
  unfold Expr.eval calldataExpr
  simp only [Expr.orderFuel,Expr.listEvalFuel]
  rw [Expr.evalFuel,args]
  simp only [pb]
  have material : r.materializeForValueUseList c [.word payer,.word escrow,.word amount] =
      .ok [.word payer,.word escrow,.word amount] := by
    simp [Runtime.materializeForValueUseList,Runtime.materializeForValueUse,
      Runtime.materializeForValueUseFuel,Bind.bind,Except.bind]
  simp only [Value.expectWord]
  have sel : SolidCore.Solidity.Shared.norm 599290589 = 599290589 := by decide
  rw [sel]
  rw [material]
  change (match abiEncodeValues? [.address,.address,.uint256] [.word payer,.word escrow,.word amount] with
    | some bs => (pure (Value.bytes (wordToBytesBE selectorBytes 599290589 ++ bs),r) : SolI (Value × Runtime))
    | none => throw (SolidityFailure.revert RevertData.typeMismatch)) = _
  rw [enc]
  rfl

def transferStmt : Stmt := .tryExternalCall .call (.var "rep") calldataExpr (.word 0)
  none false false [⟨"__ext0",.bool,false⟩] [.none]
  (.assign (.var "_sol_hoist_0") (.var "__ext0")) []

def guardStmt : Stmt := .requireStmt (.var "_sol_hoist_0")
  (some "REP transfer for initial report failed")

def actualStatements : List Stmt :=
  match Inv48.Source.model.core.findFunctionByName? "createReportEscrow" with
  | some fn => match fn.body with
    | .block ss => match ss[9]? with
      | some (Stmt.block inner) => inner
      | _ => []
    | _ => []
  | none => []




#print axioms encodeExecution
end Inv48.EscrowTrace
