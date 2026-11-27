import Inv39MovementMarkerChecked
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39
inductive MarkerCompleted (A : Nat → Prop) (s : State) (b : Balances) : Change → State → Balances → Prop where
  | mint (caller self addr v : Nat) (post : State) (out : List Source.Value) (callerFit : caller<R) (owner : Nat) (ownerFit : owner<R) (stored : s.immutable? "zoltar"=some (.word owner))
      (valid : addr<2^160) (seen : A addr) (valueFit : v<R)
      (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "mint") (Child.callContext caller self) s [.word addr,.word v]=some (.returned post out)) :
      MarkerCompleted A s b (.mint v) post (setBalance addr (balance addr b+v) b)
  | burn (caller self addr v : Nat) (post : State) (out : List Source.Value) (callerFit : caller<R) (owner : Nat) (ownerFit : owner<R) (stored : s.immutable? "zoltar"=some (.word owner))
      (valid : addr<2^160) (seen : A addr) (valueFit : v<R)
      (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "burn") (Child.callContext caller self) s [.word addr,.word v]=some (.returned post out)) :
      MarkerCompleted A s b (.burn v) post (setBalance addr (balance addr b-v) b)
  | transfer (src dst v self : Nat) (post : State) (out : List Source.Value) (srcFit : src<2^160) (dstFit : dst<2^160)
      (S : A src) (D : A dst) (valueFit : v<R)
      (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "transfer") (Child.callContext src self) s [.word dst,.word v]=some (.returned post out)) :
      MarkerCompleted A s b .unchanged post (move src dst v b)
  | transferFrom (src dst caller self v : Nat) (post : State) (out : List Source.Value) (sx : src<2^160) (dy : dst<2^160) (cv : caller<2^160)
      (valueFit : v<R) (X : A src) (Y : A dst) (typed : s.loadSlot (Allowance.slot src caller)<R)
      (disjoint : s.loadSlot (Allowance.slot src caller)<R-1 → Allowance.Separate A src caller)
      (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "transferFrom") (Child.callContext caller self) s [.word src,.word dst,.word v]=some (.returned post out))
      (key : s.loadSlot (Allowance.slot src caller)<R-1 → Init.MarkerHistory.Apart (Allowance.slot src caller)) :
      MarkerCompleted A s b .unchanged post (move src dst v b)
  | approve (caller self spender v : Nat) (post : State) (out : List Source.Value) (cw : caller<2^160) (sw : spender<2^160)
      (vf : v<R) (separate : Allowance.Separate A caller spender)
      (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "approve") (Child.callContext caller self) s [.word spender,.word v]=some (.returned post out))
      (key : Init.MarkerHistory.Apart (Allowance.slot caller spender)) :
      MarkerCompleted A s b .unchanged post b
  | cancelAuthorization (c : Context) (o nonce v rr ss : Nat) (post : State) (out : List Source.Value)
      (wf : StorageMap.WF s.storage) (tf : StorageMap.WF s.transient) (noValue : c.value=0) (disjoint : Auth.Separate A (Auth.flagSlot o nonce))
      (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "cancelAuthorization") c s (Auth.cancelArgs o nonce v rr ss)=some (.returned post out))
      (key : Init.MarkerHistory.Apart (Auth.flagSlot o nonce)) :
      MarkerCompleted A s b .unchanged post b
  | permit (c : Context) (o sp v deadline vv rr ss : Nat) (post : State) (out : List Source.Value) (ow : o<2^160) (sw : sp<2^160)
      (vf : v<R) (df : deadline<R) (byte : vv<256) (wf : StorageMap.WF s.storage) (tf : StorageMap.WF s.transient) (noValue : c.value=0)
      (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls)
      (nonce : Auth.Separate A (Auth.nonceSlot o)) (allowance : Allowance.Separate A o sp)
      (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "permit") c s (Auth.permitArgs o sp v deadline vv rr ss)=some (.returned post out))
      (nonceKey : Init.MarkerHistory.Apart (Auth.nonceSlot o)) (allowanceKey : Init.MarkerHistory.Apart (Allowance.slot o sp)) :
      MarkerCompleted A s b .unchanged post b
  | signedTransfer (receive_ : Bool) (c : Context) (p : Auth.Payment) (post : State) (out : List Source.Value)
      (widths : Auth.Widths p) (wf : StorageMap.WF s.storage) (tf : StorageMap.WF s.transient) (noValue : c.value=0)
      (S : A p.from_) (D : A p.to_) (flag : Auth.Separate A (Auth.flagSlot p.from_ p.nonce))
      (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls)
      (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name (Auth.publicName receive_)) c s (Auth.signedArgs p)=some (.returned post out))
      (key : Init.MarkerHistory.Apart (Auth.flagSlot p.from_ p.nonce)) :
      MarkerCompleted A s b .unchanged post (move p.from_ p.to_ p.value b)
theorem markerCompletedAccounts {A : Nat → Prop} {s post : State} {b b' : Balances} {ch : Change}
    (step : MarkerCompleted A s b ch post b') (sep : SlotSeparation A) (book : Books A s b)
    (solvent : total b≤s.loadSlot theoretical.slot) (fit : s.loadSlot theoretical.slot<R) (marker : BalanceApart A) :
    Books A post b' ∧ ch.apply (observed s)=some (observed post) ∧ post.loadSlot theoretical.slot<R ∧ post.loadSlot 7=s.loadSlot 7 := by
  cases step with
  | mint caller self addr v post out callerFit owner ownerFit stored valid seen valueFit actual =>
    have same : caller=owner := by
      by_contra h
      have failed := Child.wrongCaller .mint s caller self addr v owner valueFit callerFit ownerFit h stored
      change TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "mint") _ _ _ = _ at failed
      rw [actual] at failed; cases failed
    have auth : s.immutable? "zoltar"=some (.word caller) := same ▸ stored
    have allowed : total b+v≤s.loadSlot theoretical.slot := by
      by_contra! high
      have over : s.loadSlot theoretical.slot<s.loadSlot circulating.slot+v := by simpa only [book.issued] using high
      have issuedFit := lt_of_le_of_lt solvent fit
      obtain ⟨err,failed⟩ := Child.aboveCap s caller self addr v callerFit auth valueFit (book.issued ▸ issuedFit) fit over
      rw [actual] at failed; cases failed
    have nz : addr≠0 := by
      intro h; subst addr
      have failed := Child.zeroAddressRejected .mint s caller self v callerFit auth valueFit fit (fun _ => book.issued ▸ allowed)
      change TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "mint") _ _ _ = _ at failed
      rw [actual] at failed; cases failed
    obtain ⟨s',ev,books,cap,mark⟩ := Child.publicMintMarker s A b caller self addr v callerFit auth valid nz seen sep book allowed fit marker
    rw [actual] at ev; cases ev
    refine ⟨books,?_,cap ▸ fit,mark⟩
    simp only [Change.apply,observed,book.issued,allowed,if_true,cap,books.issued,mint]
  | burn caller self addr v post out callerFit owner ownerFit stored valid seen valueFit actual =>
    have same : caller=owner := by
      by_contra h
      have failed := Child.wrongCaller .burn s caller self addr v owner valueFit callerFit ownerFit h stored
      change TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "burn") _ _ _ = _ at failed
      rw [actual] at failed; cases failed
    have auth : s.immutable? "zoltar"=some (.word caller) := same ▸ stored
    have nz : addr≠0 := by
      intro h; subst addr
      have failed := Child.zeroAddressRejected .burn s caller self v callerFit auth valueFit fit (by intro x; cases x)
      change TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "burn") _ _ _ = _ at failed
      rw [actual] at failed; cases failed
    have enough : v≤balance addr b := by
      by_contra! low
      have failed := Child.underfundedBurn s caller self addr v callerFit auth valid nz valueFit
        (by simpa only [book.balances addr seen] using low)
      rw [actual] at failed; cases failed
    obtain ⟨s',ev,books,cap,mark⟩ := Child.publicBurnMarker s A b caller self addr v callerFit auth valid nz seen sep book enough solvent fit marker
    rw [actual] at ev; cases ev
    have cover := le_trans enough (balanceLE addr b)
    refine ⟨books,?_,cap ▸ lt_of_le_of_lt (Nat.sub_le _ _) fit,mark⟩
    simp only [Change.apply,observed,book.issued,cover,if_true,cap,books.issued,burn _ _ _ enough]
  | transfer src dst v self post out sv dv S D valueFit actual =>
    have good : ¬Motion.invalidEndpoint .transfer src dst := by
      intro invalid
      have failed := Transfer.transferRejected s src dst v self sv dv valueFit _ (.zero invalid)
      rw [actual] at failed; cases failed
    have sn : src≠0 := fun h => good (.inl h)
    have dn : dst≠0 := fun h => good (.inr ⟨rfl,h⟩)
    have enough : v≤balance src b := by
      by_contra! low
      have failed := Transfer.transferRejected s src dst v self sv dv valueFit _ (.low sn dn
        (by simpa only [book.balances src S] using low))
      rw [actual] at failed; cases failed
    obtain ⟨q,ev,books,cap,mark⟩ := Transfer.publicTransferMarker s A b src dst v self sv dv sn dn S D sep book enough (lt_of_le_of_lt solvent fit) marker
    rw [actual] at ev; cases ev
    refine ⟨books,?_,cap ▸ fit,mark⟩
    simp only [Change.apply,observed,cap,book.issued,books.issued,movePreserves _ _ _ _ enough]
  | transferFrom src dst caller self v post out sx dy cv valueFit X Y typed disjoint actual key =>
    obtain ⟨enough,books,cap,mark⟩ := Allowance.actualTransferFromMarker s post A b src dst caller self v out sx dy cv valueFit X Y typed disjoint sep book
      (lt_of_le_of_lt solvent fit) marker key actual
    refine ⟨books,?_,cap ▸ fit,mark⟩
    simp only [Change.apply,observed,cap,book.issued,books.issued,movePreserves _ _ _ _ enough]
  | approve caller self spender v post out cw sw vf separate actual key =>
    have changed := Allowance.actualApproval s post caller self spender v out cw sw vf actual
    let afterWrite := s.storeSlot (Allowance.slot caller spender) v
    have clean : Books A afterWrite b :=
      ⟨writeOutsideBalances _ _ _ _ _ _ book.balances separate.balances,(loadUnchanged _ _ _ _ separate.issued).trans book.issued⟩
    have books := clean.ofStorageEq changed
    have cap : post.loadSlot theoretical.slot=s.loadSlot theoretical.slot := by
      simpa only [State.loadSlot,changed] using loadUnchanged s _ v _ separate.ceiling
    refine ⟨books,by simp only [Change.apply,observed,books.issued,book.issued,cap],cap ▸ fit,?_⟩
    exact Init.MarkerHistory.approval _ _ _ _ _ _ _ cw sw vf key actual
  | cancelAuthorization c o nonce v rr ss post out wf tf noValue disjoint actual key =>
    obtain ⟨books,cap⟩ := Auth.cancelledBooks c s post A b o nonce v rr ss out book disjoint wf tf noValue actual
    refine ⟨books,by simp only [Change.apply,observed,books.issued,book.issued,cap],cap ▸ fit,?_⟩
    exact Init.MarkerHistory.cancellation _ _ _ _ _ _ _ _ _ wf tf noValue key actual
  | permit c o sp v deadline vv rr ss post out ow sw vf df byte wf tf noValue fields events nonce allowance actual nonceKey allowanceKey =>
    obtain ⟨books,cap⟩ := Auth.permittedBooks c s post A b o sp v deadline vv rr ss out book nonce allowance ow sw vf df byte wf tf noValue fields events actual
    refine ⟨books,by simp only [Change.apply,observed,books.issued,book.issued,cap],cap ▸ fit,?_⟩
    exact Init.MarkerHistory.permit _ _ _ _ _ _ _ _ _ _ _ ow sw vf df byte wf tf noValue fields events nonceKey allowanceKey actual
  | signedTransfer receive_ c p post out widths wf tf noValue S D flag fields events actual key =>
    obtain ⟨enough,books,cap,mark⟩ := Auth.actualPaymentMarker receive_ c s post p out A b widths wf tf noValue S D sep flag book
      (lt_of_le_of_lt solvent fit) marker key fields events actual
    refine ⟨books,?_,cap ▸ fit,mark⟩
    simp only [Change.apply,observed,cap,book.issued,books.issued,movePreserves _ _ _ _ enough]

end Inv39
