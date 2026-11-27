import Inv48CloneGettersVisible
import Inv48GeneratedGetterTails
import Inv48MinimaInternal
import Inv48PositiveSyntax
open SolidCore.Solidity.Source
namespace Inv48.CollateralMinimum
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
abbrev table := Inv48.Source.model.core.table
abbrev tmp := Inv03.Bodies.tmp
abbrev universeRet := "_ret_universeId_0"
abbrev universeView := "#view47403"
abbrev aggregateRet := "_ret_aggregateExposureAttoEth_0"
abbrev aggregateKey := "__internal_aggregateExposureAttoEth()#[]"
abbrev minimumKey := "__internal_minimumToken1ReportAttoEth()#[]"
def hoist (target key : String) : Stmt := .block [
  .varDecl .uint256 target none,
  .captureReturn [target] (.internalCall [target] key []),
  .assign (.var tmp) (.var target)]
def aggregateList : List Stmt := [
  .varDecl .uint256 tmp none,
  hoist universeRet Inv48.CloneRead.universeKey,
  .varDecl .uint256 universeView (some (.castOp .uintCleanup 248 (.var tmp))),
  .varDecl .uint256 tmp none,
  Inv48.Minima.readWord (Inv48.Minima.oracleData 2603245787 universeView),
  .returnValues [.castOp .uintCleanup 256 (.var tmp)]]
def aggregateBody : Stmt := .block [.skip,.block [.block aggregateList]]
def aggregateFn : InternalFunction := ⟨aggregateKey,[],[⟨"_ret0",.uint256,false⟩],aggregateBody,none⟩


theorem seqRun (n : Nat) (c : Context) (r s : Runtime) (rows : ScriptedResponder)
    (a : Stmt) (rest : List Stmt) (out : Result)
    (first : (Stmt.eval n table c r a).runWith rows = .ok (.normal s))
    (last : (Stmt.evalList n table c s rest).runWith rows = .ok out) :
    (Stmt.evalList n table c r (a::rest)).runWith rows = .ok out := by
  rw [Stmt.evalList,Inv12.runWithBind,first]
  exact last

theorem blockRun (n : Nat) (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (ss : List Stmt) (out : Result)
    (body : (Stmt.evalList n table c r.pushScope ss).runWith rows = .ok out) :
    (Stmt.eval (n+1) table c r (.block ss)).runWith rows = .ok (out.mapRuntime Runtime.popScope) := by
  rw [Stmt.eval]
  change (Stmt.evalList n table c r.pushScope ss >>= _).runWith rows = _
  rw [Inv12.runWithBind,body]
  rfl

theorem captureRun (n : Nat) (c : Context) (r s : Runtime) (rows : ScriptedResponder)
    (target key : String)
    (call : (Stmt.eval n table c r (.internalCall [target] key [])).runWith rows = .ok (.normal s)) :
    (Stmt.eval (n+1) table c r (.captureReturn [target] (.internalCall [target] key []))).runWith rows = .ok (.normal s) := by
  rw [Stmt.eval]
  change (Stmt.eval n table c r (.internalCall [target] key []) >>= _).runWith rows = _
  rw [Inv12.runWithBind,call]
  rfl
#print axioms seqRun
#print axioms blockRun
#print axioms captureRun
end Inv48.CollateralMinimum
namespace Inv48.CollateralMinimum
open Inv32Shapes

def aggregateOraclePattern : Pattern Stmt :=
  ⟨Inv48.Minima.readWord (Inv48.Minima.oracleData 2603245787 universeView), fun
   | .tryExternalCall .staticcall (.immutable "securityPool")
      (.encode .withSelector (some (.word 2603245787)) [] [.uint256] [.castOp .uintCast 248 (.var "#view47403")])
      (.word 0) none false false [⟨"__ext0",.uint256,false⟩] [.uint 256]
      (.assign (.var "_sol_hoist_0") (.castOp .uintCleanup 256 (.var "__ext0"))) [] => true
   | _ => false, by intro s h; dsimp only at h; split at h <;> first | rfl | contradiction⟩
def aggregatePattern : Pattern Stmt :=
  Stmt_block (seq [Stmt_skip, Stmt_block (seq [Stmt_block (seq [
    Stmt_varDecl Ty_uint256 (lit tmp) Option_none,
    Stmt_block (seq [Stmt_varDecl Ty_uint256 (lit universeRet) Option_none,
      Stmt_captureReturn (seq [lit universeRet]) (Stmt_internalCall (seq [lit universeRet]) (lit Inv48.CloneRead.universeKey) List_nil),
      Stmt_assign (LValue_var (lit tmp)) (Expr_var (lit universeRet))]),
    Stmt_varDecl Ty_uint256 (lit universeView) (Option_some (Expr_castOp CastKind_uintCleanup (lit 248) (Expr_var (lit tmp)))),
    Stmt_varDecl Ty_uint256 (lit tmp) Option_none,
    aggregateOraclePattern,
    Stmt_returnValues (seq [Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit tmp))])])])])
def aggregateFnPattern := Inv48.CloneGetters.fnPattern aggregateKey
  [Inv48.CloneGetters.binding "_ret0" Ty_uint256] aggregatePattern

theorem aggregateCertified : (Option_some aggregateFnPattern).test (table.lookup? aggregateKey) = true := by native_decide
theorem aggregateLookup : table.lookup? aggregateKey = some aggregateFn :=
  (Option_some aggregateFnPattern).sound _ aggregateCertified
#print axioms aggregateLookup
end Inv48.CollateralMinimum
