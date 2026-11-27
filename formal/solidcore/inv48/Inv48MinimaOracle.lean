import Inv48MinimaBindings
import Inv48MinimaExternal
import Inv12DeadlineReads
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv48.Minima
theorem sourceCastRead (c : Context) (r : Runtime) (source : Nat) (name : String) (hi : source<2^248)
    (lookup : r.lookupLocal? name=some (.word source)) :
    Inv40.Reads c r (.castOp .uintCast 248 (.var name)) source := by
  have fit : source<Inv32Division.R := lt_trans hi (by decide)
  have cast : uintCast? 248 (.word source)=.ok (.word source) := by
    norm_num at hi
    simp [uintCast?,Value.forceAbiLazy,Value.asStorageWord?,
      show Shared.norm source=source from Nat.mod_eq_of_lt fit,Nat.mod_eq_of_lt hi,Bind.bind,Except.bind]
  intro fuel enough
  change 2≤fuel at enough
  obtain ⟨k,rfl⟩ := Nat.exists_eq_add_of_le' enough
  rw [Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ lookup]
  change (do let v ← liftM (uintCast? 248 (.word source));pure (v,r) : SolI (Value × Runtime))=_
  rw [cast];rfl


def oracleData (selector : Nat) (name : String) : Source.Expr :=
  .encode .withSelector (some (.word selector)) [] [.uint256] [.castOp .uintCast 248 (.var name)]
def repSelector : Nat := 2328446634

theorem oracleCalldata (c : Context) (r : Runtime) (selector source : Nat) (name : String)
    (sel : selector<Inv32Division.R) (small : source<2^248)
    (lookup : r.lookupLocal? name=some (.word source)) :
    (oracleData selector name).evalWithRuntimeByContext c r=
      .ok (.bytes (Inv12.wireBytes selector [source]),r) :=
  Inv12.calldata c r selector sel _ [source] (.cons (sourceCastRead c r source name small lookup) .nil)

#print axioms oracleCalldata


theorem oracleReadRun (n : Nat) (c : Context) (r next : Runtime) (rows : ScriptedResponder)
    (selector source root exposure : Nat) (name : String)
    (out : EvmCompiler.Simulation.CallResponse)
    (sel : selector<Inv32Division.R) (small : source<2^248)
    (sourceValue : r.lookupLocal? name=some (.word source))
    (rootValue : (Source.Expr.immutable "securityPool").evalWithRuntimeByContext c r=.ok (.word root,r))
    (exposureFits : exposure<Inv32Division.R) (rootFits : root<Inv32Division.R)
    (away : wordEq root c.self=false) (success : out.success=true)
    (answer : rows.answerCall? (snapshotWorld c r.state)
      (buildCallRequest c .staticcall root (Inv12.wireBytes selector [source]) 0 none)=some out)
    (decoded : abiDecodeValuesExcept? [.uint256] ((byteArrayToBytes out.returnData).map normByte)=.ok [.word exposure])
    (old : r.lookupLocal? Inv03.Bodies.tmp=some (.word 0))
    (written : ((wordReply c r root (Inv12.wireBytes selector [source]) out).withFrame [("__ext0",.word exposure)]).assignLocal? Inv03.Bodies.tmp (.word exposure)=some next) :
    (Stmt.eval (n+2) Inv48.Source.model.core.table c r (readWord (oracleData selector name))).runWith rows=
      .ok (.normal next.popScope) :=
  readWordRun n _ c r root exposure rows out _ _
    (oracleCalldata c r selector source name sel small sourceValue) (Inv12.wireClean _ _)
    rootValue exposureFits rootFits away success answer decoded old next written
end Inv48.Minima
