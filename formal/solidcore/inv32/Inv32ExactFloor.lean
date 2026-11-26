import Inv32Shapes
open Inv32Shapes
open SolidCore.Solidity.Source
namespace Inv32Bodies.Floor
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

def key := "__internal___library_Math_mulDiv(uint256,uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]"

def shape : Pattern Stmt :=

  Stmt_block
    (seq [Stmt_assign
       (LValue_var (lit "x"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "x"))),
     Stmt_assign
       (LValue_var (lit "y"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "y"))),
     Stmt_assign
       (LValue_var (lit "denominator"))
       (Expr_castOp
         (CastKind_uintCleanup)
         (lit 256)
         (Expr_var (lit "denominator"))),
     Stmt_skip,
     Stmt_block
       (seq [Stmt_unchecked
          (Stmt_block
            (seq [Stmt_varDecl (Ty_uint256) (lit "high") Option_none,
             Stmt_varDecl (Ty_uint256) (lit "low") Option_none,
             Stmt_varDecl
               (Ty_uint256)
               (lit "_ic_arg_0")
               (Option_some (Expr_castOp
                  (CastKind_uintCleanup)
                  (lit 256)
                  (Expr_var (lit "x")))),
             Stmt_varDecl
               (Ty_uint256)
               (lit "_ic_arg_1")
               (Option_some (Expr_castOp
                  (CastKind_uintCleanup)
                  (lit 256)
                  (Expr_var (lit "y")))),
             Stmt_varDecl
               (Ty_uint256)
               (lit "_ret___library_Math_mul512_0")
               Option_none,
             Stmt_varDecl
               (Ty_uint256)
               (lit "_ret___library_Math_mul512_1")
               Option_none,
             Stmt_captureReturn
               (seq [(lit "_ret___library_Math_mul512_0"), (lit "_ret___library_Math_mul512_1")])
               (Stmt_internalCall
                 (seq [(lit "_ret___library_Math_mul512_0"), (lit "_ret___library_Math_mul512_1")])
                 (lit "__internal___library_Math_mul512(uint256,uint256)#[SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]")
                 (seq [Expr_var (lit "_ic_arg_0"), Expr_var (lit "_ic_arg_1")])),
             Stmt_assign
               (LValue_var (lit "high"))
               (Expr_var (lit "_ret___library_Math_mul512_0")),
             Stmt_assign
               (LValue_var (lit "low"))
               (Expr_var (lit "_ret___library_Math_mul512_1")),
             Stmt_ifElse
               (Expr_binary
                 (BinaryOp_eq)
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_var (lit "high")))
                 (Expr_word (lit 0)))
               (Stmt_block
                 (seq [Stmt_returnValues
                    (seq [Expr_castOp
                       (CastKind_uintCleanup)
                       (lit 256)
                       (Expr_castOp
                         (CastKind_uintCleanup)
                         (lit 256)
                         (Expr_binary
                           (BinaryOp_div)
                           (Expr_castOp
                             (CastKind_uintCleanup)
                             (lit 256)
                             (Expr_var (lit "low")))
                           (Expr_castOp
                             (CastKind_uintCleanup)
                             (lit 256)
                             (Expr_var (lit "denominator")))))])]))
               (Stmt_skip),
             Stmt_ifElse
               (Expr_binary
                 (BinaryOp_le)
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_var (lit "denominator")))
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_var (lit "high"))))
               (Stmt_block
                 (seq [Stmt_varDecl (Ty_uint256) (lit "_sol_hoist_0") Option_none,
                  Stmt_block
                    (seq [Stmt_varDecl
                       (Ty_bool)
                       (lit "_ic_arg_0")
                       (Option_some (Expr_binary
                          (BinaryOp_eq)
                          (Expr_castOp
                            (CastKind_uintCleanup)
                            (lit 256)
                            (Expr_var (lit "denominator")))
                          (Expr_word (lit 0)))),
                     Stmt_varDecl
                       (Ty_uint256)
                       (lit "_ic_arg_1")
                       (Option_some (Expr_ternary
                          (Expr_word (lit 1))
                          (Expr_word (lit 18))
                          (Expr_word (lit 18)))),
                     Stmt_varDecl
                       (Ty_uint256)
                       (lit "_ic_arg_2")
                       (Option_some (Expr_ternary
                          (Expr_word (lit 1))
                          (Expr_word (lit 17))
                          (Expr_word (lit 17)))),
                     Stmt_varDecl
                       (Ty_uint256)
                       (lit "_ret___library_Math_ternary_0")
                       Option_none,
                     Stmt_captureReturn
                       (seq [(lit "_ret___library_Math_ternary_0")])
                       (Stmt_internalCall
                         (seq [(lit "_ret___library_Math_ternary_0")])
                         (lit "__internal___library_Math_ternary(bool,uint256,uint256)#[SolidCore.Solidity.Ty.bool, SolidCore.Solidity.Ty.uint 256, SolidCore.Solidity.Ty.uint 256]")
                         (seq [Expr_var (lit "_ic_arg_0"),
                          Expr_var (lit "_ic_arg_1"),
                          Expr_var (lit "_ic_arg_2")])),
                     Stmt_assign
                       (LValue_var (lit "_sol_hoist_0"))
                       (Expr_var (lit "_ret___library_Math_ternary_0"))]),
                  Stmt_block
                    (seq [Stmt_varDecl
                       (Ty_uint256)
                       (lit "_ic_arg_0")
                       (Option_some (Expr_castOp
                          (CastKind_uintCleanup)
                          (lit 256)
                          (Expr_var (lit "_sol_hoist_0")))),
                     Stmt_captureReturn
                       (seq [])
                       (Stmt_internalCall
                         (seq [])
                         (lit "__internal___library_Panic_panic(uint256)#[SolidCore.Solidity.Ty.uint 256]")
                         (seq [Expr_var (lit "_ic_arg_0")]))])]))
               (Stmt_skip),
             Stmt_varDecl (Ty_uint256) (lit "remainder") Option_none,
             Stmt_block
               (seq [Stmt_ifElse
                  (Expr_binary
                    (BinaryOp_eq)
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_var (lit "denominator")))
                    (Expr_word (lit 0)))
                  (Stmt_assign
                    (LValue_var (lit "remainder"))
                    (Expr_word (lit 0)))
                  (Stmt_assign
                    (LValue_var (lit "remainder"))
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_mulMod
                        (Expr_var (lit "x"))
                        (Expr_var (lit "y"))
                        (Expr_var (lit "denominator"))))),
                Stmt_assign
                  (LValue_var (lit "high"))
                  (Expr_castOp
                    (CastKind_uintCleanup)
                    (lit 256)
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_binary
                        (BinaryOp_sub)
                        (Expr_castOp
                          (CastKind_uintCleanup)
                          (lit 256)
                          (Expr_var (lit "high")))
                        (Expr_ternary
                          (Expr_binary
                            (BinaryOp_gt)
                            (Expr_castOp
                              (CastKind_uintCleanup)
                              (lit 256)
                              (Expr_var (lit "remainder")))
                            (Expr_castOp
                              (CastKind_uintCleanup)
                              (lit 256)
                              (Expr_var (lit "low"))))
                          (Expr_word (lit 1))
                          (Expr_word (lit 0)))))),
                Stmt_assign
                  (LValue_var (lit "low"))
                  (Expr_castOp
                    (CastKind_uintCleanup)
                    (lit 256)
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_binary
                        (BinaryOp_sub)
                        (Expr_castOp
                          (CastKind_uintCleanup)
                          (lit 256)
                          (Expr_var (lit "low")))
                        (Expr_castOp
                          (CastKind_uintCleanup)
                          (lit 256)
                          (Expr_var (lit "remainder"))))))]),
             Stmt_varDecl
               (Ty_uint256)
               (lit "twos")
               (Option_some (Expr_castOp
                  (CastKind_uintCleanup)
                  (lit 256)
                  (Expr_binary
                    (BinaryOp_bitAnd)
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_var (lit "denominator")))
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_binary
                          (BinaryOp_sub)
                          (Expr_word (lit 0))
                          (Expr_castOp
                            (CastKind_uintCleanup)
                            (lit 256)
                            (Expr_var (lit "denominator"))))))))),
             Stmt_block
               (seq [Stmt_ifElse
                  (Expr_binary
                    (BinaryOp_eq)
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_var (lit "twos")))
                    (Expr_word (lit 0)))
                  (Stmt_assign
                    (LValue_var (lit "denominator"))
                    (Expr_word (lit 0)))
                  (Stmt_assign
                    (LValue_var (lit "denominator"))
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_binary
                          (BinaryOp_div)
                          (Expr_castOp
                            (CastKind_uintCleanup)
                            (lit 256)
                            (Expr_var (lit "denominator")))
                          (Expr_castOp
                            (CastKind_uintCleanup)
                            (lit 256)
                            (Expr_var (lit "twos"))))))),
                Stmt_ifElse
                  (Expr_binary
                    (BinaryOp_eq)
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_var (lit "twos")))
                    (Expr_word (lit 0)))
                  (Stmt_assign
                    (LValue_var (lit "low"))
                    (Expr_word (lit 0)))
                  (Stmt_assign
                    (LValue_var (lit "low"))
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_binary
                          (BinaryOp_div)
                          (Expr_castOp
                            (CastKind_uintCleanup)
                            (lit 256)
                            (Expr_var (lit "low")))
                          (Expr_castOp
                            (CastKind_uintCleanup)
                            (lit 256)
                            (Expr_var (lit "twos"))))))),
                Stmt_assign
                  (LValue_var (lit "twos"))
                  (Expr_castOp
                    (CastKind_uintCleanup)
                    (lit 256)
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_binary
                        (BinaryOp_add)
                        (Expr_ternary
                          (Expr_binary
                            (BinaryOp_eq)
                            (Expr_castOp
                              (CastKind_uintCleanup)
                              (lit 256)
                              (Expr_var (lit "twos")))
                            (Expr_word (lit 0)))
                          (Expr_word (lit 0))
                          (Expr_castOp
                            (CastKind_uintCleanup)
                            (lit 256)
                            (Expr_castOp
                              (CastKind_uintCleanup)
                              (lit 256)
                              (Expr_binary
                                (BinaryOp_div)
                                (Expr_castOp
                                  (CastKind_uintCleanup)
                                  (lit 256)
                                  (Expr_castOp
                                    (CastKind_uintCleanup)
                                    (lit 256)
                                    (Expr_binary
                                      (BinaryOp_sub)
                                      (Expr_word (lit 0))
                                      (Expr_castOp
                                        (CastKind_uintCleanup)
                                        (lit 256)
                                        (Expr_var (lit "twos"))))))
                                (Expr_castOp
                                  (CastKind_uintCleanup)
                                  (lit 256)
                                  (Expr_var (lit "twos")))))))
                        (Expr_word (lit 1)))))]),
             Stmt_exprStmt
               (Expr_assignment
                 (Option_some (BinaryOp_bitOr))
                 (Option_some (ValueCleanup_uint (lit 256)))
                 (Expr_var (lit "low"))
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_castOp
                     (CastKind_uintCleanup)
                     (lit 256)
                     (Expr_binary
                       (BinaryOp_mul)
                       (Expr_castOp
                         (CastKind_uintCleanup)
                         (lit 256)
                         (Expr_var (lit "high")))
                       (Expr_castOp
                         (CastKind_uintCleanup)
                         (lit 256)
                         (Expr_var (lit "twos"))))))),
             Stmt_varDecl
               (Ty_uint256)
               (lit "inverse")
               (Option_some (Expr_castOp
                  (CastKind_uintCleanup)
                  (lit 256)
                  (Expr_binary
                    (BinaryOp_bitXor)
                    (Expr_castOp
                      (CastKind_uintCleanup)
                      (lit 256)
                      (Expr_castOp
                        (CastKind_uintCleanup)
                        (lit 256)
                        (Expr_binary
                          (BinaryOp_mul)
                          (Expr_word (lit 3))
                          (Expr_castOp
                            (CastKind_uintCleanup)
                            (lit 256)
                            (Expr_var (lit "denominator"))))))
                    (Expr_word (lit 2))))),
             Stmt_exprStmt
               (Expr_assignment
                 (Option_some (BinaryOp_mul))
                 (Option_some (ValueCleanup_uint (lit 256)))
                 (Expr_var (lit "inverse"))
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_castOp
                     (CastKind_uintCleanup)
                     (lit 256)
                     (Expr_binary
                       (BinaryOp_sub)
                       (Expr_word (lit 2))
                       (Expr_castOp
                         (CastKind_uintCleanup)
                         (lit 256)
                         (Expr_castOp
                           (CastKind_uintCleanup)
                           (lit 256)
                           (Expr_binary
                             (BinaryOp_mul)
                             (Expr_castOp
                               (CastKind_uintCleanup)
                               (lit 256)
                               (Expr_var (lit "denominator")))
                             (Expr_castOp
                               (CastKind_uintCleanup)
                               (lit 256)
                               (Expr_var (lit "inverse")))))))))),
             Stmt_exprStmt
               (Expr_assignment
                 (Option_some (BinaryOp_mul))
                 (Option_some (ValueCleanup_uint (lit 256)))
                 (Expr_var (lit "inverse"))
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_castOp
                     (CastKind_uintCleanup)
                     (lit 256)
                     (Expr_binary
                       (BinaryOp_sub)
                       (Expr_word (lit 2))
                       (Expr_castOp
                         (CastKind_uintCleanup)
                         (lit 256)
                         (Expr_castOp
                           (CastKind_uintCleanup)
                           (lit 256)
                           (Expr_binary
                             (BinaryOp_mul)
                             (Expr_castOp
                               (CastKind_uintCleanup)
                               (lit 256)
                               (Expr_var (lit "denominator")))
                             (Expr_castOp
                               (CastKind_uintCleanup)
                               (lit 256)
                               (Expr_var (lit "inverse")))))))))),
             Stmt_exprStmt
               (Expr_assignment
                 (Option_some (BinaryOp_mul))
                 (Option_some (ValueCleanup_uint (lit 256)))
                 (Expr_var (lit "inverse"))
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_castOp
                     (CastKind_uintCleanup)
                     (lit 256)
                     (Expr_binary
                       (BinaryOp_sub)
                       (Expr_word (lit 2))
                       (Expr_castOp
                         (CastKind_uintCleanup)
                         (lit 256)
                         (Expr_castOp
                           (CastKind_uintCleanup)
                           (lit 256)
                           (Expr_binary
                             (BinaryOp_mul)
                             (Expr_castOp
                               (CastKind_uintCleanup)
                               (lit 256)
                               (Expr_var (lit "denominator")))
                             (Expr_castOp
                               (CastKind_uintCleanup)
                               (lit 256)
                               (Expr_var (lit "inverse")))))))))),
             Stmt_exprStmt
               (Expr_assignment
                 (Option_some (BinaryOp_mul))
                 (Option_some (ValueCleanup_uint (lit 256)))
                 (Expr_var (lit "inverse"))
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_castOp
                     (CastKind_uintCleanup)
                     (lit 256)
                     (Expr_binary
                       (BinaryOp_sub)
                       (Expr_word (lit 2))
                       (Expr_castOp
                         (CastKind_uintCleanup)
                         (lit 256)
                         (Expr_castOp
                           (CastKind_uintCleanup)
                           (lit 256)
                           (Expr_binary
                             (BinaryOp_mul)
                             (Expr_castOp
                               (CastKind_uintCleanup)
                               (lit 256)
                               (Expr_var (lit "denominator")))
                             (Expr_castOp
                               (CastKind_uintCleanup)
                               (lit 256)
                               (Expr_var (lit "inverse")))))))))),
             Stmt_exprStmt
               (Expr_assignment
                 (Option_some (BinaryOp_mul))
                 (Option_some (ValueCleanup_uint (lit 256)))
                 (Expr_var (lit "inverse"))
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_castOp
                     (CastKind_uintCleanup)
                     (lit 256)
                     (Expr_binary
                       (BinaryOp_sub)
                       (Expr_word (lit 2))
                       (Expr_castOp
                         (CastKind_uintCleanup)
                         (lit 256)
                         (Expr_castOp
                           (CastKind_uintCleanup)
                           (lit 256)
                           (Expr_binary
                             (BinaryOp_mul)
                             (Expr_castOp
                               (CastKind_uintCleanup)
                               (lit 256)
                               (Expr_var (lit "denominator")))
                             (Expr_castOp
                               (CastKind_uintCleanup)
                               (lit 256)
                               (Expr_var (lit "inverse")))))))))),
             Stmt_exprStmt
               (Expr_assignment
                 (Option_some (BinaryOp_mul))
                 (Option_some (ValueCleanup_uint (lit 256)))
                 (Expr_var (lit "inverse"))
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_castOp
                     (CastKind_uintCleanup)
                     (lit 256)
                     (Expr_binary
                       (BinaryOp_sub)
                       (Expr_word (lit 2))
                       (Expr_castOp
                         (CastKind_uintCleanup)
                         (lit 256)
                         (Expr_castOp
                           (CastKind_uintCleanup)
                           (lit 256)
                           (Expr_binary
                             (BinaryOp_mul)
                             (Expr_castOp
                               (CastKind_uintCleanup)
                               (lit 256)
                               (Expr_var (lit "denominator")))
                             (Expr_castOp
                               (CastKind_uintCleanup)
                               (lit 256)
                               (Expr_var (lit "inverse")))))))))),
             Stmt_assign
               (LValue_var (lit "result"))
               (Expr_castOp
                 (CastKind_uintCleanup)
                 (lit 256)
                 (Expr_castOp
                   (CastKind_uintCleanup)
                   (lit 256)
                   (Expr_binary
                     (BinaryOp_mul)
                     (Expr_castOp
                       (CastKind_uintCleanup)
                       (lit 256)
                       (Expr_var (lit "low")))
                     (Expr_castOp
                       (CastKind_uintCleanup)
                       (lit 256)
                       (Expr_var (lit "inverse")))))),
             Stmt_returnValues
               (seq [Expr_castOp
                  (CastKind_uintCleanup)
                  (lit 256)
                  (Expr_var (lit "result"))])]))])])

def body := shape.value

theorem checkedBody :
    ((Inv32Dispatch.model.core.table.lookup? key).map InternalFunction.body) = some body :=
  (Option_some shape).sound _ (by native_decide)
end Inv32Bodies.Floor
