import Inv48CloneReadExec
open SolidCore.Solidity.Source
namespace Inv48.SymbolicClone
set_option maxRecDepth 65536
set_option maxHeartbeats 40000000

def libraryBody : Stmt :=
Stmt.block
            [Stmt.skip,
             Stmt.skip,
             Stmt.block
               [Stmt.varDecl (Ty.uint256) "offset" none,
                Stmt.ifElse
                  (Expr.word 1)
                  (Stmt.assign
                    (LValue.var "offset")
                    (Expr.word 45))
                  (Stmt.assign
                    (LValue.var "offset")
                    (Expr.word 45)),
                Stmt.requireStmt
                  (Expr.binary
                    (BinaryOp.eq)
                    (Expr.castOp
                      (CastKind.uintCleanup)
                      256
                      (Expr.length
                        (Expr.envBytesLookup
                          (EnvBytesLookup.accountCode)
                          (Expr.self))))
                    (Expr.castOp
                      (CastKind.uintCleanup)
                      256
                      (Expr.castOp
                        (CastKind.uintCleanup)
                        256
                        (Expr.binary
                          (BinaryOp.add)
                          (Expr.castOp
                            (CastKind.uintCleanup)
                            256
                            (Expr.var "offset"))
                          (Expr.word 51)))))
                  (some "Universe module requires a clone"),
                Stmt.block
                  [Stmt.memoryVarDecl
                     (Ty.bytesCalldata)
                     "#extcode"
                     (some (Expr.envBytesLookup
                        (EnvBytesLookup.accountCode)
                        (Expr.self))),
                   Stmt.varDecl
                     (Ty.uint256)
                     "#extindex"
                     (some (Expr.word 0)),
                   Stmt.varDecl
                     (Ty.uint256)
                     "#extword"
                     (some (Expr.word 0)),
                   Stmt.assign
                     (LValue.var "#extword")
                     (Expr.word 0),
                   Stmt.whileLoop
                     (Expr.binary
                       (BinaryOp.lt)
                       (Expr.castOp
                         (CastKind.uintCleanup)
                         256
                         (Expr.var "#extindex"))
                       (Expr.word 31))
                     (Stmt.block
                       [Stmt.assign
                          (LValue.var "#extword")
                          (Expr.castOp
                            (CastKind.uintCleanup)
                            256
                            (Expr.binary
                              (BinaryOp.bitOr)
                              (Expr.castOp
                                (CastKind.uintCast)
                                256
                                (Expr.binary
                                  (BinaryOp.shl)
                                  (Expr.var "#extword")
                                  (Expr.word 8)))
                              (Expr.ternary
                                (Expr.binary
                                  (BinaryOp.boolAnd)
                                  (Expr.binary
                                    (BinaryOp.lt)
                                    (Expr.castOp
                                      (CastKind.uintCleanup)
                                      256
                                      (Expr.var "offset"))
                                    (Expr.castOp
                                      (CastKind.uintCleanup)
                                      256
                                      (Expr.length
                                        (Expr.var "#extcode"))))
                                  (Expr.binary
                                    (BinaryOp.lt)
                                    (Expr.castOp
                                      (CastKind.uintCleanup)
                                      256
                                      (Expr.var "#extindex"))
                                    (Expr.castOp
                                      (CastKind.uintCleanup)
                                      256
                                      (Expr.castOp
                                        (CastKind.uintCleanup)
                                        256
                                        (Expr.binary
                                          (BinaryOp.sub)
                                          (Expr.castOp
                                            (CastKind.uintCleanup)
                                            256
                                            (Expr.length
                                              (Expr.var "#extcode")))
                                          (Expr.castOp
                                            (CastKind.uintCleanup)
                                            256
                                            (Expr.var "offset")))))))
                                (Expr.castOp
                                  (CastKind.uintCleanup)
                                  256
                                  (Expr.castOp
                                    (CastKind.uintCleanup)
                                    256
                                    (Expr.castOp
                                      (CastKind.uintCast)
                                      8
                                      (Expr.index
                                        (Expr.var "#extcode")
                                        (Expr.binary
                                          (BinaryOp.add)
                                          (Expr.var "offset")
                                          (Expr.var "#extindex"))))))
                                (Expr.word 0)))),
                        Stmt.assign
                          (LValue.var "#extindex")
                          (Expr.castOp
                            (CastKind.uintCleanup)
                            256
                            (Expr.castOp
                              (CastKind.uintCleanup)
                              256
                              (Expr.binary
                                (BinaryOp.add)
                                (Expr.castOp
                                  (CastKind.uintCleanup)
                                  256
                                  (Expr.var "#extindex"))
                                (Expr.word 1))))]),
                   Stmt.assign
                     (LValue.var "universe")
                     (Expr.castOp
                       (CastKind.uintCast)
                       248
                       (Expr.castOp
                         (CastKind.uintCleanup)
                         256
                         (Expr.var "#extword"))),
                   Stmt.assign
                     (LValue.var "#extword")
                     (Expr.word 0),
                   Stmt.whileLoop
                     (Expr.binary
                       (BinaryOp.lt)
                       (Expr.castOp
                         (CastKind.uintCleanup)
                         256
                         (Expr.var "#extindex"))
                       (Expr.word 51))
                     (Stmt.block
                       [Stmt.assign
                          (LValue.var "#extword")
                          (Expr.castOp
                            (CastKind.uintCleanup)
                            256
                            (Expr.binary
                              (BinaryOp.bitOr)
                              (Expr.castOp
                                (CastKind.uintCast)
                                256
                                (Expr.binary
                                  (BinaryOp.shl)
                                  (Expr.var "#extword")
                                  (Expr.word 8)))
                              (Expr.ternary
                                (Expr.binary
                                  (BinaryOp.boolAnd)
                                  (Expr.binary
                                    (BinaryOp.lt)
                                    (Expr.castOp
                                      (CastKind.uintCleanup)
                                      256
                                      (Expr.var "offset"))
                                    (Expr.castOp
                                      (CastKind.uintCleanup)
                                      256
                                      (Expr.length
                                        (Expr.var "#extcode"))))
                                  (Expr.binary
                                    (BinaryOp.lt)
                                    (Expr.castOp
                                      (CastKind.uintCleanup)
                                      256
                                      (Expr.var "#extindex"))
                                    (Expr.castOp
                                      (CastKind.uintCleanup)
                                      256
                                      (Expr.castOp
                                        (CastKind.uintCleanup)
                                        256
                                        (Expr.binary
                                          (BinaryOp.sub)
                                          (Expr.castOp
                                            (CastKind.uintCleanup)
                                            256
                                            (Expr.length
                                              (Expr.var "#extcode")))
                                          (Expr.castOp
                                            (CastKind.uintCleanup)
                                            256
                                            (Expr.var "offset")))))))
                                (Expr.castOp
                                  (CastKind.uintCleanup)
                                  256
                                  (Expr.castOp
                                    (CastKind.uintCleanup)
                                    256
                                    (Expr.castOp
                                      (CastKind.uintCast)
                                      8
                                      (Expr.index
                                        (Expr.var "#extcode")
                                        (Expr.binary
                                          (BinaryOp.add)
                                          (Expr.var "offset")
                                          (Expr.var "#extindex"))))))
                                (Expr.word 0)))),
                        Stmt.assign
                          (LValue.var "#extindex")
                          (Expr.castOp
                            (CastKind.uintCleanup)
                            256
                            (Expr.castOp
                              (CastKind.uintCleanup)
                              256
                              (Expr.binary
                                (BinaryOp.add)
                                (Expr.castOp
                                  (CastKind.uintCleanup)
                                  256
                                  (Expr.var "#extindex"))
                                (Expr.word 1))))]),
                   Stmt.assign
                     (LValue.var "token")
                     (Expr.castOp
                       (CastKind.uintCast)
                       160
                       (Expr.var "#extword"))]]]

def clean (e : Expr) : Expr := .castOp .uintCleanup 256 e
def cast (width : Nat) (e : Expr) : Expr := .castOp .uintCast width e
def guard (stop : Nat) : Expr := .binary .lt (clean (.var "#extindex")) (.word stop)
def byteGuard : Expr := .binary .boolAnd
  (.binary .lt (clean (.var "offset")) (clean (.length (.var "#extcode"))))
  (.binary .lt (clean (.var "#extindex"))
    (clean (clean (.binary .sub (clean (.length (.var "#extcode"))) (clean (.var "offset"))))))
def byteRead : Expr := clean (clean (cast 8
  (.index (.var "#extcode") (.binary .add (.var "offset") (.var "#extindex")))))
def nextWord : Expr := clean (.binary .bitOr
  (cast 256 (.binary .shl (.var "#extword") (.word 8)))
  (.ternary byteGuard byteRead (.word 0)))
def nextIndex : Expr := clean (clean (.binary .add (clean (.var "#extindex")) (.word 1)))
def iteration : Stmt := .block [
  .assign (.var "#extword") nextWord,
  .assign (.var "#extindex") nextIndex]
def firstLoop : Stmt := .whileLoop (guard 31) iteration
def secondLoop : Stmt := .whileLoop (guard 51) iteration

theorem loops_in_body : ∃ pre middle tail,
    libraryBody = .block [.skip,.skip,.block [
      .varDecl .uint256 "offset" none,
      .ifElse (.word 1) (.assign (.var "offset") (.word 45)) (.assign (.var "offset") (.word 45)),
      pre, .block (middle ++ [firstLoop] ++ tail)]] := by
  refine ⟨_, [_,_,_,_], [_,_,_,_], rfl⟩

end Inv48.SymbolicClone
