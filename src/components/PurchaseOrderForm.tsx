import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { Me } from '../lib/api'

type Item = { description: string; qty: number; unit: string; unit_price: number; amount: number }

type CategoryKey = 'wings' | 'living' | 'techleaders' | 'resystems'

const CATEGORY_LABEL: Record<CategoryKey, string> = {
  wings: 'Wings',
  living: 'リビング',
  techleaders: 'テックリーダーズ',
  resystems: 'REシステムズ'
}

const JP_DOW = ['日', '月', '火', '水', '木', '金', '土']

const parseIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const toIso = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

const fmtSlash = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${y}/${m}/${d}`
}

const fmtJP = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${y}年${m}月${d}日`
}

const fmtJPDow = (iso: string) => `${fmtJP(iso)}（${JP_DOW[parseIso(iso).getDay()]}）`

// 期間を「closingDay 締め」で分割（例: 4/1〜5/25 かつ 25日締め → [4/1〜4/25, 4/26〜5/25]）
const splitByClosingDay = (start: string, end: string, closingDay: number) => {
  const e = parseIso(end)
  const periods: Array<{ from: string; to: string }> = []
  let cur = parseIso(start)
  while (cur <= e) {
    let closeM = cur.getMonth()
    if (cur.getDate() > closingDay) closeM += 1
    const close = new Date(cur.getFullYear(), closeM, closingDay)
    const periodEnd = close <= e ? close : e
    periods.push({ from: toIso(cur), to: toIso(periodEnd) })
    const next = new Date(periodEnd)
    next.setDate(next.getDate() + 1)
    cur = next
  }
  return periods
}

// 締日の翌月末（土日は前倒し）を支払予定日として返す
const paymentDateFor = (closeIso: string) => {
  const close = parseIso(closeIso)
  const payDate = new Date(close.getFullYear(), close.getMonth() + 2, 0) // 翌月末日
  while (payDate.getDay() === 0 || payDate.getDay() === 6) {
    payDate.setDate(payDate.getDate() - 1)
  }
  return toIso(payDate)
}

type PriceMode = 'hourly' | 'settlement_range'

type Config = {
  subject: string
  issuerCompany: string
  issuerRepresentative: string
  issuerPostal: string
  issuerAddress: string
  recipientName: string
  recipientPostal: string
  recipientAddress: string
  periodStart: string
  periodEnd: string
  closingDay: number
  hoursPerCycle: number
  ratePerHour: number
  baseMonthly: number
  unit: string
  priceMode: PriceMode
  rangeMin: number
  rangeMax: number
  deliveryLocation: string
  paymentMethod: string
}

const DEFAULTS: Record<CategoryKey, Config> = {
  wings: {
    subject: 'タマホーム様電子発注システム開発支援',
    issuerCompany: 'ウイングソリューションズ株式会社',
    issuerRepresentative: '', issuerPostal: '', issuerAddress: '',
    recipientName: '川村 卓也', recipientPostal: '', recipientAddress: '',
    periodStart: '2026-04-01', periodEnd: '2026-05-25', closingDay: 25,
    hoursPerCycle: 80, ratePerHour: 3750, baseMonthly: 600000, unit: '時間',
    priceMode: 'hourly', rangeMin: 140, rangeMax: 180,
    deliveryLocation: '客先指定場所', paymentMethod: '振込',
  },
  living: {
    subject: '',
    issuerCompany: 'ウイングソリューションズ株式会社',
    issuerRepresentative: '', issuerPostal: '', issuerAddress: '',
    recipientName: '', recipientPostal: '', recipientAddress: '',
    periodStart: '2026-04-01', periodEnd: '2026-04-30', closingDay: 25,
    hoursPerCycle: 40, ratePerHour: 3750, baseMonthly: 300000, unit: '時間',
    priceMode: 'hourly', rangeMin: 140, rangeMax: 180,
    deliveryLocation: '客先指定場所', paymentMethod: '振込',
  },
  techleaders: {
    subject: '',
    issuerCompany: 'ウイングソリューションズ株式会社',
    issuerRepresentative: '', issuerPostal: '', issuerAddress: '',
    recipientName: '', recipientPostal: '', recipientAddress: '',
    periodStart: '2026-04-01', periodEnd: '2026-04-30', closingDay: 25,
    hoursPerCycle: 80, ratePerHour: 3750, baseMonthly: 600000, unit: '時間',
    priceMode: 'hourly', rangeMin: 140, rangeMax: 180,
    deliveryLocation: '客先指定場所', paymentMethod: '振込',
  },
  resystems: {
    subject: '',
    issuerCompany: 'ウイングソリューションズ株式会社',
    issuerRepresentative: '', issuerPostal: '', issuerAddress: '',
    recipientName: '', recipientPostal: '', recipientAddress: '',
    periodStart: '2026-04-01', periodEnd: '2026-04-30', closingDay: 25,
    hoursPerCycle: 80, ratePerHour: 3750, baseMonthly: 600000, unit: '時間',
    priceMode: 'hourly', rangeMin: 140, rangeMax: 180,
    deliveryLocation: '客先指定場所', paymentMethod: '振込',
  }
}

const fromServerCfg = (cat: CategoryKey, s: any): Config => {
  if (!s || !s.exists) return DEFAULTS[cat]
  return {
    subject: s.subject ?? DEFAULTS[cat].subject,
    issuerCompany: s.issuer_company ?? DEFAULTS[cat].issuerCompany,
    issuerRepresentative: s.issuer_representative ?? '',
    issuerPostal: s.issuer_postal ?? '',
    issuerAddress: s.issuer_address ?? '',
    recipientName: s.recipient_name ?? DEFAULTS[cat].recipientName,
    recipientPostal: s.recipient_postal ?? '',
    recipientAddress: s.recipient_address ?? '',
    periodStart: s.period_start ?? DEFAULTS[cat].periodStart,
    periodEnd: s.period_end ?? DEFAULTS[cat].periodEnd,
    closingDay: s.closing_day ?? DEFAULTS[cat].closingDay,
    hoursPerCycle: s.hours_per_cycle ?? DEFAULTS[cat].hoursPerCycle,
    ratePerHour: s.rate_per_hour ?? DEFAULTS[cat].ratePerHour,
    baseMonthly: s.base_monthly ?? DEFAULTS[cat].baseMonthly,
    unit: s.unit ?? DEFAULTS[cat].unit,
    priceMode: (s.price_mode as PriceMode) ?? DEFAULTS[cat].priceMode,
    rangeMin: s.range_min ?? DEFAULTS[cat].rangeMin,
    rangeMax: s.range_max ?? DEFAULTS[cat].rangeMax,
    deliveryLocation: s.delivery_location ?? DEFAULTS[cat].deliveryLocation,
    paymentMethod: s.payment_method ?? DEFAULTS[cat].paymentMethod,
  }
}

const toServer = (cfg: Config, items: Item[], remarks: string) => ({
  subject: cfg.subject,
  issuer_company: cfg.issuerCompany,
  issuer_representative: cfg.issuerRepresentative,
  issuer_postal: cfg.issuerPostal,
  issuer_address: cfg.issuerAddress,
  recipient_name: cfg.recipientName,
  recipient_postal: cfg.recipientPostal,
  recipient_address: cfg.recipientAddress,
  period_start: cfg.periodStart,
  period_end: cfg.periodEnd,
  closing_day: cfg.closingDay,
  hours_per_cycle: cfg.hoursPerCycle,
  rate_per_hour: cfg.ratePerHour,
  base_monthly: cfg.baseMonthly,
  unit: cfg.unit,
  price_mode: cfg.priceMode,
  range_min: cfg.rangeMin,
  range_max: cfg.rangeMax,
  delivery_location: cfg.deliveryLocation,
  payment_method: cfg.paymentMethod,
  items,
  remarks,
})

const buildItems = (cfg: Config): Item[] => {
  const periods = splitByClosingDay(cfg.periodStart, cfg.periodEnd, cfg.closingDay)
  const items: Item[] = [{ description: 'システム保守・開発', qty: 0, unit: '', unit_price: 0, amount: 0 }]
  if (cfg.priceMode === 'settlement_range') {
    periods.forEach(p => {
      items.push({
        description: `（${cfg.recipientName}：${fmtSlash(p.from)}〜${fmtSlash(p.to)}）：精算幅 ${cfg.rangeMin}〜${cfg.rangeMax}時間`,
        qty: 1,
        unit: '月',
        unit_price: cfg.baseMonthly,
        amount: cfg.baseMonthly,
      })
    })
    items.push({ description: `※精算幅 ${cfg.rangeMin}〜${cfg.rangeMax}時間の範囲内は月額固定。`, qty: 0, unit: '', unit_price: 0, amount: 0 })
    items.push({ description: `※範囲外は ${cfg.ratePerHour.toLocaleString()}円/時で調整精算。`, qty: 0, unit: '', unit_price: 0, amount: 0 })
  } else {
    periods.forEach(p => {
      items.push({
        description: `（${cfg.recipientName}：${fmtSlash(p.from)}〜${fmtSlash(p.to)}）：予定工数`,
        qty: cfg.hoursPerCycle,
        unit: cfg.unit || '時間',
        unit_price: cfg.ratePerHour,
        amount: cfg.hoursPerCycle * cfg.ratePerHour,
      })
    })
    items.push({ description: '※上記金額は想定工数に基づく参考金額であり、', qty: 0, unit: '', unit_price: 0, amount: 0 })
    items.push({ description: '実際の請求額は実績稼働時間に基づき算定する。', qty: 0, unit: '', unit_price: 0, amount: 0 })
  }
  return items
}

const buildRemarks = (cfg: Config): string => {
  const periods = splitByClosingDay(cfg.periodStart, cfg.periodEnd, cfg.closingDay)
  const payDates = periods.map(p => fmtJPDow(paymentDateFor(p.to))).join('／')
  const priceBlock = cfg.priceMode === 'settlement_range' ? `・月額${cfg.baseMonthly.toLocaleString()}円を基準額とする
　（精算幅：月${cfg.rangeMin}〜${cfg.rangeMax}時間）
・精算幅の範囲内は月額固定、範囲を超過／下回る場合は ${cfg.ratePerHour.toLocaleString()}円/時で調整精算する
・月の想定稼働時間は${cfg.hoursPerCycle}時間とするが、精算幅を超える事が想定される場合には事前に双方話し合いを行う` : `・月額${cfg.baseMonthly.toLocaleString()}円を基準額とする
　（月${cfg.hoursPerCycle}時間［8時間×10日］稼働した場合）
・実績稼働時間数 × ${cfg.ratePerHour.toLocaleString()}円 により算定する完全工数精算とする
・月の想定稼働時間は${cfg.hoursPerCycle}時間とするが、この時間を超える事が想定される場合には事前に双方話し合いを行う`
  return `契約形態：準委任契約
注文期間：${fmtJP(cfg.periodStart)}〜${fmtJP(cfg.periodEnd)}
報酬条件：
${priceBlock}
・タマホーム本社（品川）への交通費は実費を別途精算する
・品川以外の作業場所までの交通費、シェアラウンジ利用料は、請負代金に含むものとする
支払条件：
・${cfg.closingDay}日締め、翌月末日支払い（35日サイト）
・支払予定日：${payDates}
調整単位：30分／日、30分／月
作業場所：都内指定場所／自宅
作業範囲：設計、開発、テスト
その他：PC貸与なし`
}

const buildDeliveryDeadline = (cfg: Config): string =>
  splitByClosingDay(cfg.periodStart, cfg.periodEnd, cfg.closingDay).map(p => fmtSlash(p.to)).join(', ')

const genOrderNo = () => 'ORD-' + Math.floor(Math.random() * 1000000).toString().padStart(6, '0')

export default function PurchaseOrderForm({ me, category, position = 0, onRemove }: { me: Me | null; category: CategoryKey; position?: number; onRemove?: () => void }) {
  const [cfg, setCfg] = useState<Config>(DEFAULTS[category])
  const [items, setItems] = useState<Item[]>(() => buildItems(DEFAULTS[category]))
  const [remarks, setRemarks] = useState<string>(() => buildRemarks(DEFAULTS[category]))
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [orderNo, setOrderNo] = useState(genOrderNo())

  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // 契約期間変更モーダル
  const [contractModalOpen, setContractModalOpen] = useState(false)
  const [modalStart, setModalStart] = useState('')
  const [modalEnd, setModalEnd] = useState('')
  const [modalClosingDay, setModalClosingDay] = useState(25)

  // カテゴリ切替で DB から設定を読み込み
  useEffect(() => {
    setLoaded(false)
    setOrderNo(genOrderNo())
    api.get('/purchase_order_setting', { params: { category, position } })
      .then(async r => {
        if (r.data?.exists) {
          const c = fromServerCfg(category, r.data)
          setCfg(c)
          setItems(Array.isArray(r.data.items) && r.data.items.length ? r.data.items : buildItems(c))
          setRemarks(typeof r.data.remarks === 'string' && r.data.remarks.length ? r.data.remarks : buildRemarks(c))
        } else {
          const base = DEFAULTS[category]
          setCfg(base); setItems(buildItems(base)); setRemarks(buildRemarks(base))
          try { await api.patch('/purchase_order_setting', { purchase_order_setting: toServer(base, buildItems(base), buildRemarks(base)) }, { params: { category, position } }) } catch {}
        }
        setLoaded(true)
      })
      .catch(() => {
        const base = DEFAULTS[category]
        setCfg(base); setItems(buildItems(base)); setRemarks(buildRemarks(base))
        setLoaded(true)
      })
  }, [category, position])

  // cfg / items / remarks 変更時に即時 DB 保存（abort なし、fire-and-forget）
  useEffect(() => {
    if (!loaded) return
    setSaving(true)
    api.patch('/purchase_order_setting', { purchase_order_setting: toServer(cfg, items, remarks) }, { params: { category, position } })
      .then(() => setSavedAt(new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })))
      .catch(() => {})
      .finally(() => setSaving(false))
  }, [category, position, cfg, items, remarks, loaded])

  const deliveryDeadline = useMemo(() => buildDeliveryDeadline(cfg), [cfg])

  const subtotal = items.reduce((s, it) => s + (it.amount || 0), 0)
  const tax = Math.round(subtotal * 0.1)
  const total = subtotal + tax

  // 契約終了月警告: 今月が period_end の月以降なら、次月以降の契約確認を促す
  const contractAlert = useMemo(() => {
    if (!cfg.periodEnd) return null
    const end = parseIso(cfg.periodEnd)
    const now = new Date()
    const nowKey = now.getFullYear() * 12 + now.getMonth()
    const endKey = end.getFullYear() * 12 + end.getMonth()
    if (nowKey < endKey) return null
    const next = new Date(end.getFullYear(), end.getMonth() + 1, 1)
    return {
      name: cfg.recipientName || '受注者',
      nextLabel: `${next.getFullYear()}年${next.getMonth() + 1}月`
    }
  }, [cfg.periodEnd, cfg.recipientName])

  const updateItem = (i: number, patchItem: Partial<Item>) => {
    setItems(prev => prev.map((it, idx) => {
      if (idx !== i) return it
      const updated = { ...it, ...patchItem }
      if ('qty' in patchItem || 'unit_price' in patchItem) {
        updated.amount = (Number(updated.qty) || 0) * (Number(updated.unit_price) || 0)
      }
      return updated
    }))
  }
  const addItem = () => setItems(prev => [...prev, { description: '', qty: 0, unit: '', unit_price: 0, amount: 0 }])
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i))

  const buildPayload = () => ({
    order_date: orderDate,
    order_no: orderNo,
    subject: cfg.subject,
    tax_rate: 10,
    category,
    recipient: { name: cfg.recipientName, postal_code: cfg.recipientPostal, address: cfg.recipientAddress },
    issuer: {
      company_name: cfg.issuerCompany,
      representative: cfg.issuerRepresentative,
      postal_code: cfg.issuerPostal,
      address: cfg.issuerAddress,
    },
    items: items.map(it => ({ description: it.description, qty: it.qty, unit: it.unit, unit_price: it.unit_price, amount: it.amount })),
    delivery_deadline: deliveryDeadline,
    delivery_location: cfg.deliveryLocation,
    payment_method: cfg.paymentMethod,
    remarks,
  })

  const submit = async () => {
    setLoading(true); setErr(null)
    try {
      const res = await api.post('/exports/purchase_order.pdf', buildPayload(), { responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `発注書_${CATEGORY_LABEL[category]}_${orderNo}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setErr(e?.response?.data?.error?.toString() ?? '発注書 PDF の生成に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const saveLocal = async () => {
    setLoading(true); setErr(null)
    try {
      const res = await api.post('/exports/purchase_order.pdf?save_local=true', buildPayload())
      alert(`保存しました:\n${(res.data as any)?.saved_to}`)
    } catch (e: any) {
      setErr(e?.response?.data?.error?.toString() ?? '保存に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const fmtYen = (n: number) => '¥' + n.toLocaleString()
  const patch = (p: Partial<Config>) => {
    const next = { ...cfg, ...p }
    setCfg(next)
    // 契約関連フィールドが変わったら明細と備考を自動再生成
    const regen: (keyof Config)[] = ['recipientName', 'periodStart', 'periodEnd', 'closingDay', 'hoursPerCycle', 'ratePerHour', 'baseMonthly', 'unit', 'priceMode', 'rangeMin', 'rangeMax']
    if (regen.some(k => k in p)) {
      setItems(buildItems(next))
      setRemarks(buildRemarks(next))
    }
  }

  const openContractModal = () => {
    setModalStart(cfg.periodStart)
    setModalEnd(cfg.periodEnd)
    setModalClosingDay(cfg.closingDay)
    setContractModalOpen(true)
  }
  const extendByMonths = (months: number) => {
    const base = modalEnd ? parseIso(modalEnd) : parseIso(cfg.periodEnd)
    const newEnd = new Date(base.getFullYear(), base.getMonth() + months, modalClosingDay || 25)
    setModalEnd(toIso(newEnd))
  }
  const confirmContract = () => {
    patch({ periodStart: modalStart, periodEnd: modalEnd, closingDay: modalClosingDay })
    setContractModalOpen(false)
  }

  const monthsDiff = (() => {
    if (!modalStart || !modalEnd) return 0
    const s = parseIso(modalStart); const e = parseIso(modalEnd)
    return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + (e.getDate() >= s.getDate() ? 1 : 0)
  })()

  return (
    <div className="glass rounded-3xl p-6 shadow-md">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-[var(--color-text-sub)]">
            発注書作成 — {CATEGORY_LABEL[category]}
            {position > 0 && <span className="ml-2 text-fuchsia-500">#{position + 1}枚目</span>}
          </div>
          <div className="mt-1 text-xs text-[var(--color-text-sub)]">
            発注者: {me?.company_name} / {me?.display_name} — 注文期間から明細と備考を自動生成 ／ 編集内容は自動で DB 保存されます
            {saving ? <span className="ml-2 text-amber-500">保存中…</span> : savedAt && <span className="ml-2 text-emerald-600">保存済 {savedAt}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            {onRemove && (
              <button
                onClick={() => { if (confirm('この発注書を削除しますか？')) onRemove() }}
                className="rounded-xl border border-red-300 bg-white px-3 py-2.5 text-sm font-semibold text-red-500 hover:bg-red-50"
                title="このシートを削除"
              >
                − 削除
              </button>
            )}
            <button
              onClick={openContractModal}
              className="rounded-xl border border-[var(--color-primary)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--color-primary)] hover:bg-[var(--color-bg)]"
            >
              📅 契約期間を変更
            </button>
            <button
              onClick={submit}
              disabled={loading || items.length === 0}
              className="rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/20 disabled:opacity-50"
            >
              {loading ? '生成中…' : '📄 発注書 PDF 出力'}
            </button>
            <button
              onClick={saveLocal}
              disabled={loading || items.length === 0}
              className="rounded-xl bg-white border border-emerald-400 px-4 py-2.5 text-sm font-semibold text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
              title="/Users/.../12 請求書類/.../川村さん/注文/ に保存"
            >
              📁 フォルダに保存
            </button>
          </div>
          {!cfg.recipientName && <span className="text-[11px] text-amber-500">※「宛先 氏名」が空のまま出力できます</span>}
        </div>
      </div>

      {contractAlert && (
        <div className="mt-4 rounded-2xl border-2 border-amber-500 bg-amber-50 px-6 py-4 shadow-md">
          <div className="text-lg md:text-xl font-bold text-amber-700 flex items-center gap-2">
            <span className="text-2xl">⚠️</span>
            {contractAlert.name}さんの{contractAlert.nextLabel}以降の契約は済んでますか？
          </div>
          <div className="mt-1 text-xs text-amber-700/80">
            現在の契約終了日は {cfg.periodEnd} です。続きの契約を結ぶ場合は下の「注文期間 終了」を更新して注文書を再発行してください。
          </div>
        </div>
      )}

      {err && <div className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-red-500">{err}</div>}

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-xs text-[var(--color-text-sub)]">発注日</span>
          <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--color-text-sub)]">発注書番号</span>
          <input value={orderNo} onChange={(e) => setOrderNo(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-mono" />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--color-text-sub)]">件名</span>
          <input value={cfg.subject} onChange={(e) => patch({ subject: e.target.value })}
            className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
        </label>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--color-border)] p-4">
        <div className="text-xs font-semibold text-[var(--color-text-sub)] mb-2">発注者情報</div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-xs text-[var(--color-text-sub)]">会社名</span>
            <input value={cfg.issuerCompany} onChange={(e) => patch({ issuerCompany: e.target.value })}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-text-sub)]">代表者名（空欄なら {me?.display_name} を使用）</span>
            <input value={cfg.issuerRepresentative} onChange={(e) => patch({ issuerRepresentative: e.target.value })}
              placeholder={me?.display_name ?? ''}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-text-sub)]">郵便番号（空欄なら {me?.postal_code || '—'} を使用）</span>
            <input value={cfg.issuerPostal} onChange={(e) => patch({ issuerPostal: e.target.value })}
              placeholder={me?.postal_code ?? '000-0000'}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-text-sub)]">住所（空欄なら登録住所を使用）</span>
            <input value={cfg.issuerAddress} onChange={(e) => patch({ issuerAddress: e.target.value })}
              placeholder={me?.address ?? ''}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
          </label>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--color-border)] p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-[var(--color-text-sub)]">契約登録</div>
          <div className="text-[11px] text-[var(--color-text-sub)]">契約期間・単価・月間工数を登録（自動で DB 保存）</div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className="text-xs text-[var(--color-text-sub)]">受注者 氏名</span>
            <input value={cfg.recipientName} onChange={(e) => patch({ recipientName: e.target.value })}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-text-sub)]">受注者 郵便番号</span>
            <input value={cfg.recipientPostal} onChange={(e) => patch({ recipientPostal: e.target.value })}
              placeholder="000-0000"
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-text-sub)]">受注者 住所</span>
            <input value={cfg.recipientAddress} onChange={(e) => patch({ recipientAddress: e.target.value })}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-6">
          <label className="block md:col-span-2">
            <span className="text-xs text-[var(--color-text-sub)]">契約開始日</span>
            <input type="date" value={cfg.periodStart} onChange={(e) => patch({ periodStart: e.target.value })}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
          </label>
          <label className="block md:col-span-2">
            <span className="text-xs text-[var(--color-text-sub)]">契約終了日</span>
            <input type="date" value={cfg.periodEnd} onChange={(e) => patch({ periodEnd: e.target.value })}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-text-sub)]">締日</span>
            <input type="number" value={cfg.closingDay} onChange={(e) => patch({ closingDay: Number(e.target.value) || 25 })}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-text-sub)]">月間工数</span>
            <input type="number" value={cfg.hoursPerCycle} onChange={(e) => patch({ hoursPerCycle: Number(e.target.value) || 0 })}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <div className="flex items-center gap-4 text-xs">
            <span className="text-[var(--color-text-sub)]">単価モード</span>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" checked={cfg.priceMode === 'hourly'} onChange={() => patch({ priceMode: 'hourly' })} />
              時間精算（実績稼働 × 単価）
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" checked={cfg.priceMode === 'settlement_range'} onChange={() => patch({ priceMode: 'settlement_range' })} />
              精算幅（範囲内は月額固定・範囲外は時間調整）
            </label>
          </div>
          {cfg.priceMode === 'settlement_range' && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-xs text-[var(--color-text-sub)]">精算幅 下限(時間)</span>
                <input type="number" value={cfg.rangeMin} onChange={(e) => patch({ rangeMin: Number(e.target.value) || 0 })}
                  className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-xs text-[var(--color-text-sub)]">精算幅 上限(時間)</span>
                <input type="number" value={cfg.rangeMax} onChange={(e) => patch({ rangeMax: Number(e.target.value) || 0 })}
                  className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
              </label>
            </div>
          )}
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-5">
          <label className="block">
            <span className="text-xs text-[var(--color-text-sub)]">単位</span>
            <input value={cfg.unit} onChange={(e) => patch({ unit: e.target.value })}
              placeholder="時間"
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-text-sub)]">単価(円/h)</span>
            <input type="number" value={cfg.ratePerHour} onChange={(e) => patch({ ratePerHour: Number(e.target.value) || 0 })}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-mono" />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-text-sub)]">月額基準(円)</span>
            <input type="number" value={cfg.baseMonthly} onChange={(e) => patch({ baseMonthly: Number(e.target.value) || 0 })}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-mono" />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-text-sub)]">納品場所</span>
            <input value={cfg.deliveryLocation} onChange={(e) => patch({ deliveryLocation: e.target.value })}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-text-sub)]">支払方法</span>
            <input value={cfg.paymentMethod} onChange={(e) => patch({ paymentMethod: e.target.value })}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
          </label>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <div className="text-xs text-[var(--color-text-sub)]">
            明細 — 納品期限: <span className="font-mono">{deliveryDeadline}</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <button onClick={addItem} className="text-fuchsia-500 hover:text-fuchsia-400">＋ 行を追加</button>
          </div>
        </div>
        <div className="mt-2 overflow-hidden rounded-xl border border-[var(--color-border)]">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-[var(--color-text-sub)]">
              <tr>
                <th className="px-3 py-2 text-left">摘要</th>
                <th className="px-3 py-2 text-right w-20">数量</th>
                <th className="px-3 py-2 text-left w-20">単位</th>
                <th className="px-3 py-2 text-right w-28">単価</th>
                <th className="px-3 py-2 text-right w-32">明細金額</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-[var(--color-border)]">
                  <td className="px-2 py-1">
                    <input value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })}
                      className="w-full rounded border border-transparent bg-transparent px-2 py-1 focus:border-[var(--color-border)] focus:bg-white" />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" value={it.qty || ''} onChange={(e) => updateItem(i, { qty: Number(e.target.value) })}
                      className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-right font-mono tabular-nums focus:border-[var(--color-border)] focus:bg-white" />
                  </td>
                  <td className="px-2 py-1">
                    <input value={it.unit} onChange={(e) => updateItem(i, { unit: e.target.value })}
                      className="w-full rounded border border-transparent bg-transparent px-2 py-1 focus:border-[var(--color-border)] focus:bg-white" />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" value={it.unit_price || ''} onChange={(e) => updateItem(i, { unit_price: Number(e.target.value) })}
                      className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-right font-mono tabular-nums focus:border-[var(--color-border)] focus:bg-white" />
                  </td>
                  <td className="px-2 py-1">
                    <div className="px-2 py-1 text-right font-mono tabular-nums text-[var(--color-text-sub)]">
                      {it.amount ? it.amount.toLocaleString() : ''}
                    </div>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <button onClick={() => removeItem(i)} className="text-red-400 hover:text-red-500" title="削除">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 text-[var(--color-text-sub)]">
              <tr>
                <td colSpan={4} className="px-3 py-1.5 text-right">小計</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtYen(subtotal)}</td>
                <td></td>
              </tr>
              <tr>
                <td colSpan={4} className="px-3 py-1.5 text-right">10% 消費税</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtYen(tax)}</td>
                <td></td>
              </tr>
              <tr>
                <td colSpan={4} className="px-3 py-1.5 text-right text-amber-600 font-semibold">発注金額</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-amber-600 font-semibold">{fmtYen(total)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <div className="text-xs text-[var(--color-text-sub)]">備考</div>
          <button onClick={() => setRemarks(buildRemarks(cfg))} className="text-xs text-fuchsia-500 hover:text-fuchsia-400">↺ 備考を再生成</button>
        </div>
        <textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={16}
          className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs font-mono leading-relaxed"
        />
      </div>

      {contractModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setContractModalOpen(false)}>
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold text-[var(--color-text)]">契約期間を変更</div>
              <button onClick={() => setContractModalOpen(false)} className="text-[var(--color-text-sub)] hover:text-[var(--color-text)]">✕</button>
            </div>
            <div className="mt-2 text-xs text-[var(--color-text-sub)]">
              現在: <span className="font-mono">{cfg.periodStart} 〜 {cfg.periodEnd}</span>（{cfg.closingDay}日締め）
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-xs text-[var(--color-text-sub)]">契約開始日</span>
                <input type="date" value={modalStart} onChange={(e) => setModalStart(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-xs text-[var(--color-text-sub)]">契約終了日</span>
                <input type="date" value={modalEnd} onChange={(e) => setModalEnd(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-xs text-[var(--color-text-sub)]">締日</span>
                <input type="number" value={modalClosingDay} onChange={(e) => setModalClosingDay(Number(e.target.value) || 25)}
                  className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
              </label>
              <div className="block">
                <span className="text-xs text-[var(--color-text-sub)]">試算: 約 <span className="font-mono">{monthsDiff}</span> ヶ月更新</span>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-xs text-[var(--color-text-sub)] mb-2">クイック延長（終了日を加算）</div>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 6, 12].map(m => (
                  <button key={m} onClick={() => extendByMonths(m)}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-gray-50">
                    +{m}ヶ月
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setContractModalOpen(false)}
                className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm text-[var(--color-text)] hover:bg-gray-50">
                キャンセル
              </button>
              <button onClick={confirmContract}
                className="rounded-lg bg-gradient-to-r from-[var(--color-primary)] to-fuchsia-500 px-5 py-2 text-sm font-semibold text-white shadow">
                更新して反映
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
