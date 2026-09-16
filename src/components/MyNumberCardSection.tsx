import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { MyNumberCardReadResult } from '../lib/api'

// 確定申告書 第一表・消費税申告書 PDF に印字する「個人番号(マイナンバー)・生年月日」の登録カード。
// 経費ページ(年間申告ビュー)の PDF ダウンロードボタン群の下に置く(設定画面ではなくここに置くのはユーザー要望)。
// 個人番号そのものは /me からは返らず末尾4桁のみ。カード画像は保存せず読み取り(OpenAI送信)だけに使う。

type RegistrationStatus = {
  registered: boolean
  last4: string | null
  birthDate: string | null
}

// "YYYY-MM-DD" → "1990年9月30日"
function formatBirthDateJapanese(birthDateIso: string): string {
  const [year, month, day] = birthDateIso.split('-')
  if (!year || !month || !day) return birthDateIso
  return `${year}年${Number(month)}月${Number(day)}日`
}

export default function MyNumberCardSection({ onMessage }: { onMessage: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<RegistrationStatus | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // 確認フォーム(読み取り結果 or 手入力)
  const [formOpen, setFormOpen] = useState(false)
  const [cardReading, setCardReading] = useState(false)
  const [cardReadResult, setCardReadResult] = useState<MyNumberCardReadResult | null>(null)
  const [myNumberValidFromReading, setMyNumberValidFromReading] = useState<boolean | null>(null)
  const [myNumberDraft, setMyNumberDraft] = useState('')
  const [birthDateDraft, setBirthDateDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const albumInputRef = useRef<HTMLInputElement | null>(null)

  const loadStatus = async () => {
    const r = await api.get('/me')
    setStatus({
      registered: !!r.data.my_number_registered,
      last4: r.data.my_number_last4 ?? null,
      birthDate: r.data.birth_date ?? null,
    })
  }
  useEffect(() => { void loadStatus().catch(() => {}) }, [])

  const openManualEntry = () => {
    setCardReadResult(null)
    setMyNumberValidFromReading(null)
    setMyNumberDraft('')
    setBirthDateDraft(status?.birthDate ?? '')
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setCardReadResult(null)
    setMyNumberValidFromReading(null)
  }

  const onCardImagesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setCardReading(true)
    try {
      const formData = new FormData()
      // 裏面(個人番号)・表面(生年月日)の最大2枚
      Array.from(files).slice(0, 2).forEach((file) => formData.append('files[]', file))
      const r = await api.post<MyNumberCardReadResult>('/me/my_number_card/read', formData)
      setCardReadResult(r.data)
      setMyNumberValidFromReading(r.data.my_number_valid)
      setMyNumberDraft(r.data.my_number ?? '')
      setBirthDateDraft(r.data.birth_date ?? status?.birthDate ?? '')
      setFormOpen(true)
    } catch (e: any) {
      onMessage(`読み取りに失敗しました: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setCardReading(false)
      if (cameraInputRef.current) cameraInputRef.current.value = ''
      if (albumInputRef.current) albumInputRef.current.value = ''
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.patch('/me', { user: { my_number: myNumberDraft, birth_date: birthDateDraft } })
      await loadStatus()
      closeForm()
      onMessage('✅ 個人番号・生年月日を保存しました')
    } catch (e: any) {
      onMessage(e?.response?.data?.error?.toString() ?? e?.message ?? '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  // 削除は window.confirm を使わず、ボタン自体を2段階にする(1回目「削除」→2回目「本当に削除」で実行)
  const onDeleteClick = async () => {
    if (!deleteConfirming) {
      setDeleteConfirming(true)
      return
    }
    setDeleting(true)
    try {
      await api.patch('/me', { user: { my_number: '', birth_date: '' } })
      await loadStatus()
      onMessage('✅ 個人番号・生年月日を削除しました')
    } catch (e: any) {
      onMessage(e?.response?.data?.error?.toString() ?? e?.message ?? '削除に失敗しました')
    } finally {
      setDeleting(false)
      setDeleteConfirming(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-sm">
      <button onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="text-sm font-semibold text-[var(--color-text)]">🪪 申告書に印字する個人番号・生年月日</span>
        <span className="text-xs text-[var(--color-text-sub)]">{open ? '閉じる ▲' : '開く ▼'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-[var(--color-border)] px-3 py-3">
          {/* 登録状態 */}
          {status?.registered ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-2.5 py-2">
              <div className="text-xs text-[var(--color-text-sub)]">
                個人番号: ****-****-{status.last4 ?? '????'}（末尾4桁）
                {status.birthDate && <>／生年月日: {formatBirthDateJapanese(status.birthDate)}</>}
              </div>
              <button onClick={onDeleteClick} disabled={deleting}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-white shadow disabled:opacity-50 ${deleteConfirming ? 'bg-red-600' : 'bg-red-400 hover:opacity-90'}`}>
                {deleting ? '削除中…' : deleteConfirming ? '本当に削除' : '削除'}
              </button>
            </div>
          ) : (
            <div className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-700">
              未登録。申告書 PDF の個人番号・生年月日欄は空欄になります
            </div>
          )}

          {/* 撮影して読み取る */}
          {!formOpen && (
            <div className="space-y-1.5">
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => onCardImagesSelected(e.target.files)} />
              <input ref={albumInputRef} type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => onCardImagesSelected(e.target.files)} />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => cameraInputRef.current?.click()} disabled={cardReading}
                  className="rounded-lg bg-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white shadow hover:opacity-90 disabled:opacity-50">
                  📷 カードを撮影
                </button>
                <button onClick={() => albumInputRef.current?.click()} disabled={cardReading}
                  className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text-sub)] hover:bg-gray-50 disabled:opacity-50">
                  🖼 写真から選ぶ
                </button>
              </div>
              <div className="text-[11px] text-[var(--color-text-sub)]">裏面（個人番号）と表面（生年月日）の2枚を選ぶと精度が上がります</div>
              {cardReading && <div className="text-xs text-fuchsia-600">AI が読み取り中…</div>}
              <button onClick={openManualEntry} className="text-[11px] text-fuchsia-600 underline">手で入力する</button>
            </div>
          )}

          {/* 確認フォーム */}
          {formOpen && (
            <div className="space-y-2 rounded-lg border border-fuchsia-200 bg-fuchsia-50/40 p-2.5">
              {cardReadResult && (cardReadResult.name || cardReadResult.address) && (
                <div className="text-[11px] text-[var(--color-text-sub)]">
                  カード記載: {[cardReadResult.name, cardReadResult.address].filter(Boolean).join(' / ')}
                </div>
              )}
              <div>
                <label className="mb-0.5 block text-[11px] text-[var(--color-text-sub)]">個人番号（12桁）</label>
                <input type="text" inputMode="numeric" maxLength={12} value={myNumberDraft}
                  onChange={(e) => setMyNumberDraft(e.target.value.replace(/[^0-9]/g, ''))}
                  className="w-full rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-sm tabular-nums" placeholder="123456789012" />
                {myNumberValidFromReading === false && myNumberDraft && (
                  <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">チェックデジットが合いません。桁を確認してください</div>
                )}
              </div>
              <div>
                <label className="mb-0.5 block text-[11px] text-[var(--color-text-sub)]">生年月日</label>
                <input type="date" value={birthDateDraft} onChange={(e) => setBirthDateDraft(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-sm" />
              </div>
              <div className="flex gap-2">
                <button onClick={save} disabled={saving || !myNumberDraft || !birthDateDraft}
                  className="rounded-lg bg-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white shadow hover:opacity-90 disabled:opacity-50">
                  {saving ? '保存中…' : '保存'}
                </button>
                <button onClick={closeForm}
                  className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs text-[var(--color-text-sub)] hover:bg-gray-50">
                  キャンセル
                </button>
              </div>
            </div>
          )}

          <div className="text-[10px] text-[var(--color-text-sub)]">
            個人番号は暗号化して保存され、画面と API には末尾4桁だけ表示されます。カード画像は保存されません（読み取りのために OpenAI に送信されます）。
          </div>
        </div>
      )}
    </div>
  )
}
