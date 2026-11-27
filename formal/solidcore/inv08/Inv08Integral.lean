import Inv08CursorExecution
import Inv08Prefix
open SolidCore.Solidity.Source Inv32Shapes Inv03.Bodies Inv32Division
namespace Inv08.Integral
def member (base : String) (index : Nat) : Pattern Expr :=
  ⟨.index (.var base) (.word index),
    fun | .index (.var n) (.word i) => n == base && i == index | _ => false,
    by intro e h; dsimp only at h; split at h <;> simp_all⟩
def rateIndex (eth : Bool) := if eth then 1 else 2
def endIndex (eth : Bool) := if eth then 3 else 4
def twice (e : Pattern Expr) := clean (clean e)
def value (eth : Bool) := twice (Expr_binary BinaryOp_add
  (twice (Expr_binary BinaryOp_mul
    (twice (Expr_binary BinaryOp_sub (clean (member "latest" (rateIndex eth))) (clean (member "expired" (rateIndex eth)))))
    (wvar "timestamp"))) (clean (member "expired" (endIndex eth))))
def amounts : Option (List Expr) := do
  let f ← model.core.table.lookup? "__internal__integral(uint48,uint48)#[SolidCore.Solidity.Ty.uint 48, SolidCore.Solidity.Ty.uint 48]"
  let .block [_,_,_,_,.block [
    .storageAliasPath "latest" "expiries" [.storageRead .load "lastExpiryId" []],
    .storageAliasPath "expired" "expiries" [.var "expiredId"],
    .assign (.var "ethIntegralNumerator") a,.assign (.var "repIntegralNumerator") b]] := f.body | none
  return [a,b]
theorem fromGenerated : amounts = some [(value true).value,(value false).value] :=
  (Option_some (seq [value true,value false])).sound _ (by native_decide)

theorem evaluate (c : Context) (r : Runtime) (eth : Bool) (latest expired weighted t : Nat)
    (ordered : expired ≤ latest) (lWord : latest < R) (tWord : t < R)
    (fits : (latest-expired)*t + weighted < R)
    (liveRate : Inv40.Reads c r (member "latest" (rateIndex eth)).value latest)
    (oldRate : Inv40.Reads c r (member "expired" (rateIndex eth)).value expired)
    (weight : Inv40.Reads c r (member "expired" (endIndex eth)).value weighted)
    (timestamp : r.lookupLocal? "timestamp" = some (.word t)) :
    Inv40.Reads c r (value eth).value ((latest-expired)*t+weighted) := by
  have eWord := lt_of_le_of_lt ordered lWord
  have diff := ReleaseQuote.binary (ReleaseQuote.readClean liveRate lWord) (ReleaseQuote.readClean oldRate eWord)
    .sub (by intro h; cases h) (by intro h; cases h) (Inv32QuoteExpr.subWord _ _ _ lWord eWord ordered)
  have dWord := lt_of_le_of_lt (Nat.sub_le latest expired) lWord
  have product := lt_of_le_of_lt (Nat.le_add_right _ _) fits
  have wWord := lt_of_le_of_lt (Nat.le_add_left _ _) fits
  have readTime := ReleaseQuote.readClean (localReads c r _ t timestamp) tWord
  have mul := ReleaseQuote.binary (ReleaseQuote.readClean (ReleaseQuote.readClean diff dWord) dWord) readTime
    .mul (by intro h; cases h) (by intro h; cases h) (Inv03.Expressions.mulWord _ _ _ dWord tWord product)
  have add := ReleaseQuote.binary (ReleaseQuote.readClean (ReleaseQuote.readClean mul product) product)
    (ReleaseQuote.readClean weight wWord) .add (by intro h; cases h) (by intro h; cases h) (Inv40.addWords _ _ _ fits)
  exact ReleaseQuote.readClean (ReleaseQuote.readClean add fits) fits
end Inv08.Integral
