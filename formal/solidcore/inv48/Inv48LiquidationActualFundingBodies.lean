import Inv48Model
open SolidCore.Solidity.Source
def actualMinimumBody : Stmt :=
  SolidCore.Solidity.Source.Stmt.block
    [SolidCore.Solidity.Source.Stmt.assign
       (SolidCore.Solidity.Source.LValue.var "proposedRepPerEthPrice")
       (SolidCore.Solidity.Source.Expr.castOp
         (SolidCore.Solidity.Source.CastKind.uintCleanup)
         256
         (SolidCore.Solidity.Source.Expr.var "proposedRepPerEthPrice")),
     SolidCore.Solidity.Source.Stmt.skip,
     SolidCore.Solidity.Source.Stmt.block
       [SolidCore.Solidity.Source.Stmt.requireStmt
          (SolidCore.Solidity.Source.Expr.binary
            (SolidCore.Solidity.Source.BinaryOp.ne)
            (SolidCore.Solidity.Source.Expr.castOp
              (SolidCore.Solidity.Source.CastKind.uintCleanup)
              256
              (SolidCore.Solidity.Source.Expr.var "proposedRepPerEthPrice"))
            (SolidCore.Solidity.Source.Expr.word 0))
          (some "Initial oracle price zero"),
        SolidCore.Solidity.Source.Stmt.block
          [SolidCore.Solidity.Source.Stmt.varDecl (SolidCore.Solidity.Source.Ty.uint256) "_sol_hoist_0" none,
           SolidCore.Solidity.Source.Stmt.block
             [SolidCore.Solidity.Source.Stmt.varDecl
                (SolidCore.Solidity.Source.Ty.uint256)
                "_ic_arg_0"
                (some (SolidCore.Solidity.Source.Expr.castOp
                   (SolidCore.Solidity.Source.CastKind.uintCleanup)
                   256
                   (SolidCore.Solidity.Source.Expr.var "proposedRepPerEthPrice"))),
              SolidCore.Solidity.Source.Stmt.varDecl
                (SolidCore.Solidity.Source.Ty.uint256)
                "_ic_arg_1"
                (some (SolidCore.Solidity.Source.Expr.castOp
                   (SolidCore.Solidity.Source.CastKind.uintCleanup)
                   256
                   (SolidCore.Solidity.Source.Expr.immutable "targetPriceErrorForDispute"))),
              SolidCore.Solidity.Source.Stmt.varDecl
                (SolidCore.Solidity.Source.Ty.uint256)
                "_ret___library_OraclePriceMath_liquidationPrice_0"
                none,
              SolidCore.Solidity.Source.Stmt.captureReturn
                ["_ret___library_OraclePriceMath_liquidationPrice_0"]
                (SolidCore.Solidity.Source.Stmt.internalCall
                  ["_ret___library_OraclePriceMath_liquidationPrice_0"]
                  "__internal___library_OraclePriceMath_liquidationPrice(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
                  [SolidCore.Solidity.Source.Expr.var "_ic_arg_0", SolidCore.Solidity.Source.Expr.var "_ic_arg_1"]),
              SolidCore.Solidity.Source.Stmt.assign
                (SolidCore.Solidity.Source.LValue.var "_sol_hoist_0")
                (SolidCore.Solidity.Source.Expr.var "_ret___library_OraclePriceMath_liquidationPrice_0")],
           SolidCore.Solidity.Source.Stmt.varDecl
             (SolidCore.Solidity.Source.Ty.uint256)
             "#view47500"
             (some (SolidCore.Solidity.Source.Expr.castOp
                (SolidCore.Solidity.Source.CastKind.uintCleanup)
                256
                (SolidCore.Solidity.Source.Expr.castOp
                  (SolidCore.Solidity.Source.CastKind.uintCast)
                  256
                  (SolidCore.Solidity.Source.Expr.var "_sol_hoist_0")))),
           SolidCore.Solidity.Source.Stmt.requireStmt
             (SolidCore.Solidity.Source.Expr.binary
               (SolidCore.Solidity.Source.BinaryOp.ne)
               (SolidCore.Solidity.Source.Expr.castOp
                 (SolidCore.Solidity.Source.CastKind.uintCleanup)
                 256
                 (SolidCore.Solidity.Source.Expr.var "#view47500"))
               (SolidCore.Solidity.Source.Expr.word 0))
             (some "Oracle liquidation price is zero")],
        SolidCore.Solidity.Source.Stmt.varDecl (SolidCore.Solidity.Source.Ty.uint256) "_sol_hoist_0" none,
        SolidCore.Solidity.Source.Stmt.block
          [SolidCore.Solidity.Source.Stmt.varDecl
             (SolidCore.Solidity.Source.Ty.uint256)
             "_ret_minimumToken1ReportAttoEth_0"
             none,
           SolidCore.Solidity.Source.Stmt.captureReturn
             ["_ret_minimumToken1ReportAttoEth_0"]
             (SolidCore.Solidity.Source.Stmt.internalCall
               ["_ret_minimumToken1ReportAttoEth_0"]
               "__internal_minimumToken1ReportAttoEth()#[]"
               []),
           SolidCore.Solidity.Source.Stmt.assign
             (SolidCore.Solidity.Source.LValue.var "_sol_hoist_0")
             (SolidCore.Solidity.Source.Expr.var "_ret_minimumToken1ReportAttoEth_0")],
        SolidCore.Solidity.Source.Stmt.varDecl (SolidCore.Solidity.Source.Ty.uint256) "_sol_hoist_1" none,
        SolidCore.Solidity.Source.Stmt.block
          [SolidCore.Solidity.Source.Stmt.varDecl
             (SolidCore.Solidity.Source.Ty.uint256)
             "_ret_minimumToken2ReportAttoRep_0"
             none,
           SolidCore.Solidity.Source.Stmt.captureReturn
             ["_ret_minimumToken2ReportAttoRep_0"]
             (SolidCore.Solidity.Source.Stmt.internalCall
               ["_ret_minimumToken2ReportAttoRep_0"]
               "__internal_minimumToken2ReportAttoRep()#[]"
               []),
           SolidCore.Solidity.Source.Stmt.assign
             (SolidCore.Solidity.Source.LValue.var "_sol_hoist_1")
             (SolidCore.Solidity.Source.Expr.var "_ret_minimumToken2ReportAttoRep_0")],
        SolidCore.Solidity.Source.Stmt.varDecl (SolidCore.Solidity.Source.Ty.uint256) "_sol_hoist_2" none,
        SolidCore.Solidity.Source.Stmt.block
          [SolidCore.Solidity.Source.Stmt.varDecl
             (SolidCore.Solidity.Source.Ty.uint256)
             "_ic_arg_0"
             (some (SolidCore.Solidity.Source.Expr.castOp
                (SolidCore.Solidity.Source.CastKind.uintCleanup)
                256
                (SolidCore.Solidity.Source.Expr.var "_sol_hoist_1"))),
           SolidCore.Solidity.Source.Stmt.varDecl
             (SolidCore.Solidity.Source.Ty.uint256)
             "_ic_arg_1"
             (some (SolidCore.Solidity.Source.Expr.ternary
                (SolidCore.Solidity.Source.Expr.word 1)
                (SolidCore.Solidity.Source.Expr.word 1000000000000000000)
                (SolidCore.Solidity.Source.Expr.word 1000000000000000000))),
           SolidCore.Solidity.Source.Stmt.varDecl
             (SolidCore.Solidity.Source.Ty.uint256)
             "_ic_arg_2"
             (some (SolidCore.Solidity.Source.Expr.castOp
                (SolidCore.Solidity.Source.CastKind.uintCleanup)
                256
                (SolidCore.Solidity.Source.Expr.var "proposedRepPerEthPrice"))),
           SolidCore.Solidity.Source.Stmt.varDecl
             (SolidCore.Solidity.Source.Ty.uint256)
             "_ic_arg_3"
             (some (SolidCore.Solidity.Source.Expr.enumFromUInt
                3
                (SolidCore.Solidity.Source.Expr.castOp
                  (SolidCore.Solidity.Source.CastKind.uintCleanup)
                  256
                  (SolidCore.Solidity.Source.Expr.word 1)))),
           SolidCore.Solidity.Source.Stmt.varDecl
             (SolidCore.Solidity.Source.Ty.uint256)
             "_ret___library_Math_mulDiv_overload_1_0"
             none,
           SolidCore.Solidity.Source.Stmt.captureReturn
             ["_ret___library_Math_mulDiv_overload_1_0"]
             (SolidCore.Solidity.Source.Stmt.internalCall
               ["_ret___library_Math_mulDiv_overload_1_0"]
               "__internal___library_Math_mulDiv_overload_1(uint256,uint256,uint256,uint8)#[SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.uint 256,\n SolidCore.Solidity.Ty.enum { segments := [\"Math\", \"Rounding\"] } 3]"
               [SolidCore.Solidity.Source.Expr.var "_ic_arg_0",
                SolidCore.Solidity.Source.Expr.var "_ic_arg_1",
                SolidCore.Solidity.Source.Expr.var "_ic_arg_2",
                SolidCore.Solidity.Source.Expr.var "_ic_arg_3"]),
           SolidCore.Solidity.Source.Stmt.assign
             (SolidCore.Solidity.Source.LValue.var "_sol_hoist_2")
             (SolidCore.Solidity.Source.Expr.var "_ret___library_Math_mulDiv_overload_1_0")],
        SolidCore.Solidity.Source.Stmt.varDecl (SolidCore.Solidity.Source.Ty.uint256) "_sol_hoist_3" none,
        SolidCore.Solidity.Source.Stmt.block
          [SolidCore.Solidity.Source.Stmt.varDecl
             (SolidCore.Solidity.Source.Ty.uint256)
             "_ic_arg_0"
             (some (SolidCore.Solidity.Source.Expr.castOp
                (SolidCore.Solidity.Source.CastKind.uintCleanup)
                256
                (SolidCore.Solidity.Source.Expr.var "_sol_hoist_0"))),
           SolidCore.Solidity.Source.Stmt.varDecl
             (SolidCore.Solidity.Source.Ty.uint256)
             "_ic_arg_1"
             (some (SolidCore.Solidity.Source.Expr.castOp
                (SolidCore.Solidity.Source.CastKind.uintCleanup)
                256
                (SolidCore.Solidity.Source.Expr.castOp
                  (SolidCore.Solidity.Source.CastKind.uintCast)
                  256
                  (SolidCore.Solidity.Source.Expr.var "_sol_hoist_2")))),
           SolidCore.Solidity.Source.Stmt.varDecl (SolidCore.Solidity.Source.Ty.uint256) "_ret___library_Math_max_0" none,
           SolidCore.Solidity.Source.Stmt.captureReturn
             ["_ret___library_Math_max_0"]
             (SolidCore.Solidity.Source.Stmt.internalCall
               ["_ret___library_Math_max_0"]
               "__internal___library_Math_max(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
               [SolidCore.Solidity.Source.Expr.var "_ic_arg_0", SolidCore.Solidity.Source.Expr.var "_ic_arg_1"]),
           SolidCore.Solidity.Source.Stmt.assign
             (SolidCore.Solidity.Source.LValue.var "_sol_hoist_3")
             (SolidCore.Solidity.Source.Expr.var "_ret___library_Math_max_0")],
        SolidCore.Solidity.Source.Stmt.returnValues
          [SolidCore.Solidity.Source.Expr.castOp
             (SolidCore.Solidity.Source.CastKind.uintCleanup)
             256
             (SolidCore.Solidity.Source.Expr.castOp
               (SolidCore.Solidity.Source.CastKind.uintCast)
               256
               (SolidCore.Solidity.Source.Expr.var "_sol_hoist_3"))]]]

def actualLiquidationLibraryBody : Stmt :=
  SolidCore.Solidity.Source.Stmt.block
    [SolidCore.Solidity.Source.Stmt.assign
       (SolidCore.Solidity.Source.LValue.var "price")
       (SolidCore.Solidity.Source.Expr.castOp
         (SolidCore.Solidity.Source.CastKind.uintCleanup)
         256
         (SolidCore.Solidity.Source.Expr.var "price")),
     SolidCore.Solidity.Source.Stmt.assign
       (SolidCore.Solidity.Source.LValue.var "uncertainty")
       (SolidCore.Solidity.Source.Expr.castOp
         (SolidCore.Solidity.Source.CastKind.uintCleanup)
         256
         (SolidCore.Solidity.Source.Expr.var "uncertainty")),
     SolidCore.Solidity.Source.Stmt.skip,
     SolidCore.Solidity.Source.Stmt.block
       [SolidCore.Solidity.Source.Stmt.requireStmt
          (SolidCore.Solidity.Source.Expr.binary
            (SolidCore.Solidity.Source.BinaryOp.lt)
            (SolidCore.Solidity.Source.Expr.castOp
              (SolidCore.Solidity.Source.CastKind.uintCleanup)
              256
              (SolidCore.Solidity.Source.Expr.var "uncertainty"))
            (SolidCore.Solidity.Source.Expr.ternary
              (SolidCore.Solidity.Source.Expr.word 1)
              (SolidCore.Solidity.Source.Expr.word 10000000)
              (SolidCore.Solidity.Source.Expr.word 10000000)))
          (some "Invalid oracle uncertainty"),
        SolidCore.Solidity.Source.Stmt.varDecl (SolidCore.Solidity.Source.Ty.uint256) "_sol_hoist_0" none,
        SolidCore.Solidity.Source.Stmt.block
          [SolidCore.Solidity.Source.Stmt.varDecl
             (SolidCore.Solidity.Source.Ty.uint256)
             "_ic_arg_0"
             (some (SolidCore.Solidity.Source.Expr.castOp
                (SolidCore.Solidity.Source.CastKind.uintCleanup)
                256
                (SolidCore.Solidity.Source.Expr.var "price"))),
           SolidCore.Solidity.Source.Stmt.varDecl
             (SolidCore.Solidity.Source.Ty.uint256)
             "_ic_arg_1"
             (some (SolidCore.Solidity.Source.Expr.ternary
                (SolidCore.Solidity.Source.Expr.word 1)
                (SolidCore.Solidity.Source.Expr.word 10000000)
                (SolidCore.Solidity.Source.Expr.word 10000000))),
           SolidCore.Solidity.Source.Stmt.varDecl
             (SolidCore.Solidity.Source.Ty.uint256)
             "_ic_arg_2"
             (some (SolidCore.Solidity.Source.Expr.castOp
                (SolidCore.Solidity.Source.CastKind.uintCleanup)
                256
                (SolidCore.Solidity.Source.Expr.castOp
                  (SolidCore.Solidity.Source.CastKind.uintCleanup)
                  256
                  (SolidCore.Solidity.Source.Expr.binary
                    (SolidCore.Solidity.Source.BinaryOp.add)
                    (SolidCore.Solidity.Source.Expr.ternary
                      (SolidCore.Solidity.Source.Expr.word 1)
                      (SolidCore.Solidity.Source.Expr.word 10000000)
                      (SolidCore.Solidity.Source.Expr.word 10000000))
                    (SolidCore.Solidity.Source.Expr.castOp
                      (SolidCore.Solidity.Source.CastKind.uintCleanup)
                      256
                      (SolidCore.Solidity.Source.Expr.var "uncertainty")))))),
           SolidCore.Solidity.Source.Stmt.varDecl
             (SolidCore.Solidity.Source.Ty.uint256)
             "_ret___library_Math_mulDiv_0"
             none,
           SolidCore.Solidity.Source.Stmt.captureReturn
             ["_ret___library_Math_mulDiv_0"]
             (SolidCore.Solidity.Source.Stmt.internalCall
               ["_ret___library_Math_mulDiv_0"]
               "__internal___library_Math_mulDiv(uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"
               [SolidCore.Solidity.Source.Expr.var "_ic_arg_0",
                SolidCore.Solidity.Source.Expr.var "_ic_arg_1",
                SolidCore.Solidity.Source.Expr.var "_ic_arg_2"]),
           SolidCore.Solidity.Source.Stmt.assign
             (SolidCore.Solidity.Source.LValue.var "_sol_hoist_0")
             (SolidCore.Solidity.Source.Expr.var "_ret___library_Math_mulDiv_0")],
        SolidCore.Solidity.Source.Stmt.returnValues
          [SolidCore.Solidity.Source.Expr.castOp
             (SolidCore.Solidity.Source.CastKind.uintCleanup)
             256
             (SolidCore.Solidity.Source.Expr.castOp
               (SolidCore.Solidity.Source.CastKind.uintCast)
               256
               (SolidCore.Solidity.Source.Expr.var "_sol_hoist_0"))]]]

set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
