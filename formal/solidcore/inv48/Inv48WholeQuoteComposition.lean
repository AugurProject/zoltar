import Inv48WholeQuoteSyntax
import Inv48WholeQuoteReachedTail
import Inv48WholeQuoteReachedMinimum
import Inv48WholeQuoteReturn
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.WholeQuote
set_option maxRecDepth 1000000
set_option maxHeartbeats 4000000
open QuoteMemory

opaque sealedExpr (e : Expr) : {x : Expr // x=e} := ⟨e,rfl⟩

def haltXRaw := (cleanP (fieldP 0)).value
def haltYRaw := (cleanP (immutableP "escalationHaltMultiplierBps")).value
def denomRaw := bpsP.value
def feeXRaw := (cleanP (cleanP (Inv32Shapes.Expr_binary Inv32Shapes.BinaryOp_add (cleanP envP)
  (cleanP (immutableP "initialReportPriorityFeeAttoEthPerGas"))))).value
def feeYRaw := (cleanP (immutableP "maxSettlementBaseFeeMultiplierBps")).value
def haltX := (sealedExpr haltXRaw).val
theorem haltX_eq : haltX = haltXRaw := (sealedExpr haltXRaw).property
def haltY := (sealedExpr haltYRaw).val
theorem haltY_eq : haltY = haltYRaw := (sealedExpr haltYRaw).property
def denom := (sealedExpr denomRaw).val
theorem denom_eq : denom = denomRaw := (sealedExpr denomRaw).property
def feeX := (sealedExpr feeXRaw).val
theorem feeX_eq : feeX = feeXRaw := (sealedExpr feeXRaw).property
def feeY := (sealedExpr feeYRaw).val
theorem feeY_eq : feeY = feeYRaw := (sealedExpr feeYRaw).property
opaque oracleCodeLock : {code : List Stmt // code = oracleP.map Inv32Shapes.Pattern.value} :=
  ⟨oracleP.map Inv32Shapes.Pattern.value,rfl⟩
def oracleCode := oracleCodeLock.val
theorem oracleCode_eq : oracleCode = oracleP.map Inv32Shapes.Pattern.value := oracleCodeLock.property
def minPrefix := minPrefixP.map Inv32Shapes.Pattern.value
def prepared (r : Runtime) (p a b : Nat) := (allocated r p a b).pushScope.pushScope

def tailCode := floorCode 2 haltX haltY denom ++ oracleCode ++ [haltUpdateStmt] ++ upperGuards ++
  [.assign (.index (.var "quote") (.word 3)) exposureExpr] ++ floorCode 4 feeX feeY denom

theorem bodyForm : bodyP.value = .block (prologue ++ [.block
    (minP.value :: collateralWrite :: fundingCode ++ tailCode)]) := by
  unfold tailCode
  rw [oracleCode_eq,haltX_eq,haltY_eq,denom_eq,feeX_eq,feeY_eq]
  rfl

theorem entryJoin (n : Nat) (table : FunctionTable) (c : Context) (base out : Runtime)
    (p a bounty : Nat) (trace : EvmCompiler.Simulation.Interaction.Transcript)
    (hp : p<R) (ha : a<R) (hb : bounty<R)
    (interior : Reached (Stmt.evalList (n+20) table c (prepared base p a bounty)
      (minP.value :: collateralWrite :: fundingCode ++ tailCode)) trace out) :
    Reached (Stmt.eval (n+22) table c (entry base p a bounty) bodyP.value) trace out.popScope.popScope := by
  have inner := reachedBlock (n+20) table c (allocated base p a bounty).pushScope out _ _ interior
  have pro := prologueExecution (n+20) table c base p a bounty hp ha hb
  rw [bodyForm]
  apply reachedBlock (n+21) table c (entry base p a bounty) out.popScope
  have pre : Reached (Stmt.evalList (n+21) table c (entry base p a bounty).pushScope prologue)
      [] (allocated base p a bounty).pushScope := by
    rw [pro]; exact reachedPure _
  have last : Reached (Stmt.evalList (n+21) table c (allocated base p a bounty).pushScope
      [.block (minP.value :: collateralWrite :: fundingCode ++ tailCode)]) trace out.popScope := by
    rw [singleList]; exact inner
  simpa only [List.nil_append] using reachedAppend (n+21) table c
    (entry base p a bounty).pushScope (allocated base p a bounty).pushScope out.popScope prologue
    [.block (minP.value :: collateralWrite :: fundingCode ++ tailCode)] [] trace pre last

theorem bodyFromLookup (table : FunctionTable) (fn : InternalFunction)
    (sourceBody : (table.lookup? quoteKey).map InternalFunction.body = some bodyP.value)
    (linked : table.lookup? quoteKey = some fn) : fn.body = bodyP.value := by
  rw [linked] at sourceBody
  exact Option.some.inj sourceBody

theorem interiorJoin (fuel : Nat) (table : FunctionTable) (c : Context) (r mid out : Runtime)
    (first rest : EvmCompiler.Simulation.Interaction.Transcript)
    (guard : Reached (Stmt.eval fuel table c r minP.value) first r)
    (funding : Stmt.evalList fuel table c r (collateralWrite :: fundingCode) = pure (.normal mid))
    (tail : Reached (Stmt.evalList fuel table c mid tailCode) rest out) :
    Reached (Stmt.evalList fuel table c r (minP.value :: collateralWrite :: fundingCode ++ tailCode))
      (first++rest) out := by
  have fundRun : Reached (Stmt.evalList fuel table c r (collateralWrite :: fundingCode)) [] mid := by
    rw [funding]; exact reachedPure _
  have restRun := reachedAppend fuel table c r mid out (collateralWrite :: fundingCode) tailCode [] rest fundRun tail
  have guardRun : Reached (Stmt.evalList fuel table c r [minP.value]) first r := by
    rw [singleList]; exact guard
  simpa only [List.nil_append,List.singleton_append] using
    reachedAppend fuel table c r r out [minP.value] ((collateralWrite :: fundingCode) ++ tailCode)
      first rest guardRun (by simpa only [List.nil_append] using restRun)

#print axioms entryJoin
#print axioms interiorJoin
end Inv48.WholeQuote
