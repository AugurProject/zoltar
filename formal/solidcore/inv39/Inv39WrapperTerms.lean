import Inv39SignedTemps
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Auth
def signedCall := Source.Stmt.internalCall [] signedKey [.var "_ic_arg_0", .var "_ic_arg_1", .var "_ic_arg_2", .var "_ic_arg_3", .var "_ic_arg_4", .var "_ic_arg_5", .var "_ic_arg_6", .var "_ic_arg_7", .var "_ic_arg_8", .var "_ic_arg_9"]
def loadAll (bs : List Source.Byte) : List Source.Stmt := [
  .varDecl (.fixedBytes 32) "_ic_arg_0" (some (hashExpr bs)),
  .varDecl .address "_ic_arg_1" (some (.var "from")),
  .varDecl .address "_ic_arg_2" (some (.var "to")),
  .varDecl .uint256 "_ic_arg_3" (some (.castOp .uintCleanup 256 (.var "value"))),
  .varDecl .uint256 "_ic_arg_4" (some (.castOp .uintCleanup 256 (.var "validAfter"))),
  .varDecl .uint256 "_ic_arg_5" (some (.castOp .uintCleanup 256 (.var "validBefore"))),
  .varDecl (.fixedBytes 32) "_ic_arg_6" (some (.var "nonce")),
  .varDecl .uint256 "_ic_arg_7" (some (.castOp .uintCleanup 8 (.var "v"))),
  .varDecl (.fixedBytes 32) "_ic_arg_8" (some (.var "r")),
  .varDecl (.fixedBytes 32) "_ic_arg_9" (some (.var "s"))]
def wrap (bs : List Source.Byte) := Source.Stmt.block (loadAll bs++[.captureReturn [] signedCall])
def recipient := Source.Stmt.requireStmt (.binary .eq (.var "to") .caller) (some "ERC3009 caller must be the recipient")
def publicShape (receive_ : Bool) (bs : List Source.Byte) := Source.Stmt.block (signedPrologue++[.block ((if receive_ then [recipient] else [])++[wrap bs])])
def publicName (receive_ : Bool) := if receive_ then "receiveWithAuthorization" else "transferWithAuthorization"
def temps (r : Runtime) (bs : List Source.Byte) (p : Payment) :=
  ((((((((((r.declareLocal "_ic_arg_0" (.fixedBytes 32 (hashOf bs))).declareLocal "_ic_arg_1" (.word p.from_)).declareLocal "_ic_arg_2" (.word p.to_)).declareLocal "_ic_arg_3" (.word p.value)).declareLocal "_ic_arg_4" (.word p.validAfter)).declareLocal "_ic_arg_5" (.word p.validBefore)).declareLocal "_ic_arg_6" (.fixedBytes 32 p.nonce)).declareLocal "_ic_arg_7" (.word p.v)).declareLocal "_ic_arg_8" (.fixedBytes 32 p.r)).declareLocal "_ic_arg_9" (.fixedBytes 32 p.s))
end Inv39.Auth
