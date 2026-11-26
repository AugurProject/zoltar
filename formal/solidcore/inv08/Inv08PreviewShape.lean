import Inv08IntegralCall
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies
namespace Inv08.Preview
def key := "__internal__preview(uint48)#[SolidCore.Solidity.Ty.uint 48]"
def ge : Pattern BinaryOp := ⟨.ge,fun | .ge => true | _ => false,by intro v h; cases v <;> simp_all⟩
def forward := Stmt_requireStmt (Expr_binary ge (Expiry.w48 "until") (Expiry.clean48 (Expiry.refField "releasedThrough")))
  (Option_some (lit "Fee time moved backwards"))
abbrev tmp := "_sol_hoist_0"
abbrev a0 := "_ic_arg_0"
abbrev a1 := "_ic_arg_1"
abbrev er := "_ret__expired_0"
abbrev ie := "_ret__integral_0"
abbrev ir := "_ret__integral_1"
def callCaptured (key : String) (targets args : List String) :=
  let ts := seq (targets.map lit)
  Stmt_captureReturn ts (Stmt_internalCall ts (lit key) (seq (args.map varP)))
def find := block [Expiry.typed a0 (Expiry.w48 "until"),decl er Option_none,callCaptured Expiry.key [er] [a0],assign tmp (varP er)]
def initAmounts := [decl "ethIntegralNumerator" Option_none,decl "repIntegralNumerator" Option_none,
  Expiry.typed a0 (Expiry.w48 "until"),Expiry.typed a1 (Expiry.w48 "expiredId"),decl ie Option_none,decl ir Option_none]
def copyAmounts := [assign "ethIntegralNumerator" (varP ie),assign "repIntegralNumerator" (varP ir)]
def out := Stmt_returnValues ReleaseQuote.expected
def steps := [forward,decl tmp Option_none,find,assign "expiredId" (Expiry.w48 tmp)] ++ initAmounts ++
  [callCaptured Integral.key [ie,ir] [a0,a1]] ++ copyAmounts ++ [out]
def body := block [assign "until" (Expiry.w48 "until"),Stmt_skip,Stmt_skip,Stmt_skip,block steps]
theorem link : Inv32Library.LinkAt model.core.table key [.word "until"] [.word "ethAmount",.word "repAmount",.word "expiredId"] body.value :=
  Inv32Library.linkAt _ _ _ _ _ (by native_decide) ((Option_some body).sound _ (by native_decide))

def q (s : State) (tm : Nat) := Expiry.fromState s tm
def value (s : State) (tm : Nat) (eth : Bool) := Integral.numerator s tm (q s tm) eth
def payout (s : State) (tm : Nat) (eth : Bool) := (value s tm eth-stored s (cursorField eth))/stored s .duration
structure Ready (s : State) (tm : Nat) : Prop where
  time : tm<2^48
  forward : stored s .through ≤ tm
  ordered : stored s .settled ≤ stored s .latest
  settled : stored s .settled=0 ∨ Expiry.endsAt s (stored s .settled)≤tm
  sorted : ∀ i j, 0<i → i≤j → j≤stored s .latest → Expiry.endsAt s i≤Expiry.endsAt s j
  rateOrder : Integral.RateOrder s (q s tm)
  fits : ∀ eth, value s tm eth<Inv32Division.R
  cursors : ∀ eth, stored s (cursorField eth)≤value s tm eth
  duration : 0<stored s .duration
theorem Ready.qFit (h : Ready s tm) : q s tm<2^48 :=
  lt_of_le_of_lt (Expiry.selectedBoundary _ _ _ _ h.ordered h.settled (Expiry.latestFits _) h.sorted).2.1 (Expiry.latestFits _)

end Inv08.Preview
