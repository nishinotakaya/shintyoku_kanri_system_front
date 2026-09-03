import axios from 'axios'
import { api, resolveApiBaseUrl } from './api'

// 相手向け公開ページ(/sign/contracts/:token)はログイン不要。
// api インスタンスは interceptor で JWT を自動付与するため、公開 API には使わず専用インスタンスを用いる。
export const publicApi = axios.create({
  baseURL: resolveApiBaseUrl(),
})

export type ContractParty = {
  name: string
  address: string
  representative: string
  email?: string // 乙のみ。メール送付の宛先既定値
}

export type ContractArticle = {
  heading: string
  body: string
  // true の場合、この条文の前で改ページする(紙の原本のページ位置を PDF 上で再現するためのフラグ)
  page_break_before?: boolean
}

// 契約書のテンプレート。standard=従来の業務委託契約書(15条)、transport=HAUKUR運送の運送業務委託契約書(全29条)。
// 未指定(standard)が既定
export type ContractTemplate = 'standard' | 'transport'

export type ContractStatus = 'draft' | 'sent' | 'signed' | 'void'

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  draft: '下書き',
  sent: '送付済',
  signed: '署名済',
  void: '無効',
}

export const CONTRACT_STATUS_BADGE_CLASS: Record<ContractStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-sky-100 text-sky-700',
  signed: 'bg-emerald-100 text-emerald-700',
  void: 'bg-red-100 text-red-700',
}

// 発行者(認証あり)向けの契約書 JSON
export type Contract = {
  id: number
  title: string
  status: ContractStatus
  party_a: ContractParty
  party_b: ContractParty
  contract_date: string | null
  start_on: string | null
  end_on: string | null
  articles: ContractArticle[]
  special_terms: string | null
  share_url?: string // issue の応答にだけ含む
  share_expires_at: string | null
  sent_at: string | null
  signed_at: string | null
  signer_name: string | null
  content_sha256: string | null
  has_signed_pdf: boolean
  editable: boolean
  user_name: string
  created_at: string
  updated_at: string
}

// 編集フォームで扱う入力値。日付は <input type="date"> 用に空文字許容の string で保持し、
// 送信直前に null へ変換する(PurchaseOrdersPage の period_start/period_end と同じ扱い)。
export type ContractFormInput = {
  title: string
  party_a_name: string
  party_a_address: string
  party_a_representative: string
  party_b_name: string
  party_b_address: string
  party_b_representative: string
  party_b_email: string
  contract_date: string
  start_on: string
  end_on: string
  articles: ContractArticle[]
  special_terms: string
}

export function contractToFormInput(contract: Contract): ContractFormInput {
  return {
    title: contract.title,
    party_a_name: contract.party_a.name,
    party_a_address: contract.party_a.address,
    party_a_representative: contract.party_a.representative,
    party_b_name: contract.party_b.name,
    party_b_address: contract.party_b.address,
    party_b_representative: contract.party_b.representative,
    party_b_email: contract.party_b.email ?? '',
    contract_date: contract.contract_date ?? '',
    start_on: contract.start_on ?? '',
    end_on: contract.end_on ?? '',
    articles: contract.articles,
    special_terms: contract.special_terms ?? '',
  }
}

export function formatContractDate(value: string | null | undefined): string {
  if (!value) return '—'
  return value.slice(0, 10)
}

export function formatContractDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('ja-JP')
}

// 一覧・一括DLで共通の契約日フィルター
export type ContractFilter = {
  contractDateFrom?: string
  contractDateTo?: string
}

function contractFilterParams(filter?: ContractFilter): Record<string, string> {
  const params: Record<string, string> = {}
  if (filter?.contractDateFrom) params.contract_date_from = filter.contractDateFrom
  if (filter?.contractDateTo) params.contract_date_to = filter.contractDateTo
  return params
}

export async function fetchContracts(filter?: ContractFilter): Promise<Contract[]> {
  const res = await api.get<Contract[]>('/contracts', { params: contractFilterParams(filter) })
  return res.data
}

// フィルターに合致する契約書PDFのzip一括ダウンロード
export async function fetchContractsZipBlob(filter?: ContractFilter): Promise<Blob> {
  const res = await api.get('/contracts/bulk_pdf', { params: contractFilterParams(filter), responseType: 'blob' })
  return res.data as Blob
}

// メール本文にこの文字列を書くと、送信時にサーバが実際の署名リンクへ置き換える
export const SIGN_URL_PLACEHOLDER = '{署名URL}'

export async function sendContractEmail(
  id: number,
  payload: { to: string; subject: string; body: string },
): Promise<Contract & { email_sent: boolean }> {
  const res = await api.post<Contract & { email_sent: boolean }>(`/contracts/${id}/send_email`, payload)
  return res.data
}

// AI添削。OPENAI 未設定・失敗時は polished: false で入力がそのまま返る
export async function polishContractEmail(
  id: number,
  payload: { subject: string; body: string },
): Promise<{ subject: string; body: string; polished: boolean }> {
  const res = await api.post<{ subject: string; body: string; polished: boolean }>(`/contracts/${id}/polish_email`, payload)
  return res.data
}

export async function fetchContract(id: number): Promise<Contract> {
  const res = await api.get<Contract>(`/contracts/${id}`)
  return res.data
}

// 新規作成は template のみ指定して送る。タイトル(transport 以外)・条文の既定値・甲情報は backend 側が補完する。
// title を渡すと backend の既定タイトル("業務委託契約書")を上書きできる(transport 選択時に使う)。
export async function createContract(template: ContractTemplate = 'standard', title?: string): Promise<Contract> {
  const res = await api.post<Contract>('/contracts', {
    contract: title ? { title } : {},
    template,
  })
  return res.data
}

export async function updateContract(id: number, form: ContractFormInput): Promise<Contract> {
  const res = await api.patch<Contract>(`/contracts/${id}`, {
    contract: {
      title: form.title,
      party_a_name: form.party_a_name,
      party_a_address: form.party_a_address,
      party_a_representative: form.party_a_representative,
      party_b_name: form.party_b_name,
      party_b_address: form.party_b_address,
      party_b_representative: form.party_b_representative,
      party_b_email: form.party_b_email,
      contract_date: form.contract_date || null,
      start_on: form.start_on || null,
      end_on: form.end_on || null,
      articles: form.articles,
      special_terms: form.special_terms,
    },
  })
  return res.data
}

export async function deleteContract(id: number): Promise<void> {
  await api.delete(`/contracts/${id}`)
}

// 署名リンクを発行(再発行時は旧リンクを無効化)。応答にのみ share_url を含む。
export async function issueContract(id: number): Promise<Contract> {
  const res = await api.post<Contract>(`/contracts/${id}/issue`)
  return res.data
}

export async function duplicateContract(id: number): Promise<Contract> {
  const res = await api.post<Contract>(`/contracts/${id}/duplicate`)
  return res.data
}

export async function voidContract(id: number): Promise<Contract> {
  const res = await api.post<Contract>(`/contracts/${id}/void`)
  return res.data
}

export async function fetchContractPdfBlob(id: number): Promise<Blob> {
  const res = await api.get(`/contracts/${id}/pdf`, { responseType: 'blob' })
  return res.data as Blob
}

// ---- 公開 API (相手向け、認証ヘッダなし) ----

export type PublicContract = {
  title: string
  party_a: ContractParty
  party_b: ContractParty
  contract_date: string | null
  start_on: string | null
  end_on: string | null
  articles: ContractArticle[]
  special_terms: string | null
  status: ContractStatus
  signed_at: string | null
  signer_name: string | null
  signable: boolean
  expired: boolean
}

export async function fetchPublicContract(token: string): Promise<PublicContract> {
  const res = await publicApi.get<PublicContract>(`/public/contracts/${token}`)
  return res.data
}

export type SignContractPayload = {
  signer_name: string
  signature_image: string
  agreed: boolean
  consent_electronic: boolean
}

export async function signPublicContract(
  token: string,
  payload: SignContractPayload,
): Promise<{ status: 'signed'; signed_at: string }> {
  const res = await publicApi.post(`/public/contracts/${token}/sign`, payload)
  return res.data
}

export async function fetchPublicContractPdfBlob(token: string): Promise<Blob> {
  const res = await publicApi.get(`/public/contracts/${token}/pdf`, { responseType: 'blob' })
  return res.data as Blob
}
